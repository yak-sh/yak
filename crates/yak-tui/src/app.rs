// The cockpit's state and the graph reads behind it. A read is a bulk pull —
// projects and tasks each in one `rows_of_kind` (never row-at-a-time), bucketed
// by project in memory — and the render walks that in-memory shape, so no draw
// ever scans the store (M-17862). Per-entity `requires`/`wants` edges are
// pulled lazily on expand and cached until the next reload, so a redraw touches
// no SQL. Liveness is the catchup feed: a cheap `data_version` pragma is the
// wake (the same foreign-write detector catchup.ts polls), and only a real bump
// drains the journal and reloads — never a fixed-interval scan of the graph.

use std::collections::{HashMap, HashSet};

use ratatui::style::Color;
use serde_json::{Map, Value};
use yak_kernel::{
    apply, data_version, default_gates, vocab, ApplyOpts, Change, Dep, Feed, Gate, Row, Store,
    WriteStore,
};

use crate::theme;

// One visible line: an entity (or a project header) at a tree depth. The draw
// layer turns this into styled spans; it holds no store handle.
pub struct Node {
    pub key: String,
    pub eid: String,
    pub depth: u16,
    pub glyph: char,
    pub glyph_color: Color,
    pub id: String,
    pub title: String,
    pub meta: String, // an edge's type, or a project's task count
    pub meta_color: Color,
    pub expandable: bool,
    pub expanded: bool,
}

pub struct App {
    pub db: String,
    store: Store,
    // The read/write split yak-bridge uses (main.rs): a read-only `Store` for
    // the Graph projection and the journal feed, a separate READ_WRITE
    // `WriteStore` for the one apply() the cockpit issues. apply()'s own `begin
    // immediate` + short transaction is the concurrent-writer discipline, so
    // this queues politely behind the server's batches and holds no long lock.
    write: WriteStore,
    gates: Vec<Box<dyn Gate>>,
    pub status_msg: String,
    // bulk-loaded graph shape
    projects: Vec<Row>,
    tasks_by_project: HashMap<String, Vec<Row>>, // "" bucket = unfiled
    task_ix: HashMap<String, Row>,
    // lazy per-entity caches, cleared on reload
    edges: HashMap<String, Vec<Dep>>, // eid -> its requires/wants out-edges
    rows: HashMap<String, Option<Row>>, // non-task edge children, fetched once
    // ui
    pub expanded: HashSet<String>,
    pub sel: usize,
    pub visible: Vec<Node>,
    pub quit: bool,
    // liveness
    feed: Feed,
    last_version: i64,
    pub live_events: u64,
}

// A comp column as a string, or None if absent.
fn cstr(r: &Row, comp: &str, prop: &str) -> Option<String> {
    r.comps.get(comp)?.as_object()?.get(prop)?.as_str().map(str::to_string)
}

fn id_of(r: &Row) -> String {
    vocab().id_of(&r.kind, &r.eid, r.num)
}

const EDGE_TYPES: [&str; 2] = ["requires", "wants"];

impl App {
    pub fn new(store: Store, write: WriteStore, db: String) -> App {
        let feed = Feed::from_tip(&store.conn);
        let last_version = data_version(&store.conn);
        let mut app = App {
            db,
            store,
            write,
            gates: default_gates(),
            status_msg: String::new(),
            projects: vec![],
            tasks_by_project: HashMap::new(),
            task_ix: HashMap::new(),
            edges: HashMap::new(),
            rows: HashMap::new(),
            expanded: HashSet::new(),
            sel: 0,
            visible: vec![],
            quit: false,
            feed,
            last_version,
            live_events: 0,
        };
        app.reload();
        // Open on the first project's tasks so the tree is visible at a glance.
        if let Some(p) = app
            .projects
            .iter()
            .find(|p| app.tasks_by_project.get(&p.eid).map(|t| !t.is_empty()).unwrap_or(false))
        {
            app.expanded.insert(format!("p:{}", p.eid));
        }
        app.rebuild_visible();
        app
    }

    // Bulk read: one query per kind, bucketed. Caches drop — a live child's
    // status may have moved, so nothing stale survives a reload.
    fn reload(&mut self) {
        self.projects = self.store.rows_of_kind("project");
        self.tasks_by_project.clear();
        self.task_ix.clear();
        self.edges.clear();
        self.rows.clear();
        for t in self.store.rows_of_kind("task") {
            let proj = cstr(&t, "task", "project").unwrap_or_default();
            self.task_ix.insert(t.eid.clone(), t.clone());
            self.tasks_by_project.entry(proj).or_default().push(t);
        }
    }

    // The wake: is there a foreign commit since we last looked? A single pragma,
    // not a scan. On a bump we drain the journal (advancing the feed cursor,
    // counting events for the status bar) and reload the bulk shape.
    pub fn tick_live(&mut self) {
        let v = data_version(&self.store.conn);
        if v == self.last_version {
            return;
        }
        self.last_version = v;
        let mut n = 0u64;
        self.feed.settle(&self.store.conn, &mut |_r| n += 1);
        if n == 0 {
            return; // a bump with nothing new past our cursor (e.g. a checkpoint)
        }
        self.live_events += n;
        let key = self.selected_key();
        self.reload();
        self.rebuild_visible();
        self.restore_selection(key);
    }

    // An entity's `requires`/`wants` out-edges, num-stable order, fetched once.
    fn child_edges(&mut self, eid: &str) -> Vec<Dep> {
        if let Some(e) = self.edges.get(eid) {
            return e.clone();
        }
        let all = self.store.deps_of(eid);
        let out: Vec<Dep> = all
            .into_iter()
            .filter(|d| d.parent == eid && EDGE_TYPES.contains(&d.type_.as_str()))
            .collect();
        self.edges.insert(eid.to_string(), out.clone());
        out
    }

    // The row for an edge child: a task is already in the bulk index; anything
    // else is fetched once (screened for tombstone/quarantine by the Store).
    fn row_of(&mut self, eid: &str) -> Option<Row> {
        if let Some(t) = self.task_ix.get(eid) {
            return Some(t.clone());
        }
        if let Some(r) = self.rows.get(eid) {
            return r.clone();
        }
        let r = self.store.row(eid);
        self.rows.insert(eid.to_string(), r.clone());
        r
    }

    // A task is gated when it is unfinished and holds a `requires` edge to a
    // task that is itself unfinished — the blocked facet (gated() in live.ts).
    fn gated(&mut self, eid: &str) -> bool {
        let deps = self.child_edges(eid);
        deps.iter().filter(|d| d.type_ == "requires").any(|d| {
            self.task_ix
                .get(&d.child)
                .and_then(|c| cstr(c, "task", "status"))
                .map(|s| s != "done" && s != "cancelled")
                .unwrap_or(false)
        })
    }

    // Rebuild the flat visible list from the roots, honoring the expanded set.
    pub fn rebuild_visible(&mut self) {
        let key = self.selected_key();
        let mut out = Vec::new();
        let projects: Vec<(String, String)> = self
            .projects
            .iter()
            .filter(|p| self.tasks_by_project.get(&p.eid).map(|t| !t.is_empty()).unwrap_or(false))
            .map(|p| (id_of(p), p.eid.clone()))
            .collect();
        for (pid, eid) in projects {
            self.walk_project(&pid, &eid, &mut out);
        }
        // tasks with no (or an unknown) project land in an Unfiled bucket last
        if self.tasks_by_project.get("").map(|t| !t.is_empty()).unwrap_or(false) {
            self.walk_project("Unfiled", "", &mut out);
        }
        self.visible = out;
        self.restore_selection(key);
    }

    fn walk_project(&mut self, label: &str, eid: &str, out: &mut Vec<Node>) {
        let key = format!("p:{eid}");
        let tasks: Vec<Row> = self.tasks_by_project.get(eid).cloned().unwrap_or_default();
        let expanded = self.expanded.contains(&key);
        out.push(Node {
            key: key.clone(),
            eid: eid.to_string(),
            depth: 0,
            glyph: '▪',
            glyph_color: theme::GREEN,
            id: label.to_string(),
            title: String::new(),
            meta: format!("{} tasks", tasks.len()),
            meta_color: theme::GREY,
            expandable: !tasks.is_empty(),
            expanded,
        });
        if expanded {
            for t in tasks {
                self.walk_entity(&key, &t.eid, 1, None, out);
            }
        }
    }

    // One entity line (a task under a project, or an edge child under a task),
    // then — if expanded — its own `requires`/`wants` children, which is what
    // makes the wants/requires tree recurse.
    fn walk_entity(
        &mut self,
        parent: &str,
        eid: &str,
        depth: u16,
        via: Option<&str>,
        out: &mut Vec<Node>,
    ) {
        let key = match via {
            Some(t) => format!("{parent}/e:{t}:{eid}"),
            None => format!("{parent}/t:{eid}"),
        };
        let row = self.row_of(eid);
        let status = row.as_ref().and_then(|r| cstr(r, "task", "status")).unwrap_or_default();
        let is_task = row.as_ref().map(|r| r.comps.contains_key("task")).unwrap_or(false);
        let gated = is_task && self.gated(eid);
        let (glyph, gcolor) =
            if is_task { theme::status_dot(&status, gated) } else { ('◦', theme::GREY) };
        let id = row.as_ref().map(id_of).unwrap_or_else(|| eid.chars().take(8).collect());
        let title =
            row.as_ref().and_then(|r| cstr(r, "doc", "title")).unwrap_or_else(|| "(gone)".into());
        let edges = self.child_edges(eid);
        let expanded = self.expanded.contains(&key);
        out.push(Node {
            key: key.clone(),
            eid: eid.to_string(),
            depth,
            glyph,
            glyph_color: gcolor,
            id,
            title,
            meta: via.unwrap_or("").to_string(),
            meta_color: via.map(theme::edge_color).unwrap_or(theme::BODY),
            expandable: !edges.is_empty(),
            expanded,
        });
        if expanded {
            for e in edges {
                self.walk_entity(&key, &e.child, depth + 1, Some(&e.type_), out);
            }
        }
    }

    // --- navigation ---

    fn selected_key(&self) -> Option<String> {
        self.visible.get(self.sel).map(|n| n.key.clone())
    }

    // Keep the cursor on the same node across a rebuild; clamp if it vanished.
    fn restore_selection(&mut self, key: Option<String>) {
        if let Some(k) = key {
            if let Some(i) = self.visible.iter().position(|n| n.key == k) {
                self.sel = i;
                return;
            }
        }
        if self.sel >= self.visible.len() {
            self.sel = self.visible.len().saturating_sub(1);
        }
    }

    pub fn down(&mut self) {
        if self.sel + 1 < self.visible.len() {
            self.sel += 1;
        }
    }

    pub fn up(&mut self) {
        self.sel = self.sel.saturating_sub(1);
    }

    pub fn top(&mut self) {
        self.sel = 0;
    }

    pub fn bottom(&mut self) {
        self.sel = self.visible.len().saturating_sub(1);
    }

    pub fn expand(&mut self) {
        if let Some(n) = self.visible.get(self.sel) {
            if n.expandable && !n.expanded {
                self.expanded.insert(n.key.clone());
                self.rebuild_visible();
            }
        }
    }

    pub fn collapse(&mut self) {
        if let Some(n) = self.visible.get(self.sel) {
            if n.expanded {
                let key = n.key.clone();
                self.expanded.remove(&key);
                self.rebuild_visible();
            } else {
                self.select_parent();
            }
        }
    }

    // Collapse an already-collapsed node by jumping to (and folding) its parent —
    // the outdent that makes `h` feel like a tree, not a list.
    fn select_parent(&mut self) {
        let Some(cur) = self.visible.get(self.sel) else { return };
        let Some(pkey) = cur.key.rsplit_once('/').map(|(p, _)| p.to_string()) else { return };
        if let Some(i) = self.visible.iter().position(|n| n.key == pkey) {
            self.sel = i;
        }
    }

    // Enter descends: expand a folded node, fold an open one.
    pub fn toggle(&mut self) {
        let Some(n) = self.visible.get(self.sel) else { return };
        if !n.expandable {
            return;
        }
        let key = n.key.clone();
        if n.expanded {
            self.expanded.remove(&key);
        } else {
            self.expanded.insert(key);
        }
        self.rebuild_visible();
    }

    // The one WRITE the skeleton proves end to end: advance the selected task's
    // status (open→wip→done→open) through the kernel apply() — a real
    // {eid, name:"task", comp:{status}} patch down the gated write path, not a
    // direct UPDATE. The commit bumps data_version on our read connection, so
    // tick_live() below re-reads it exactly as a foreign write would — the write
    // and the render close the same loop.
    pub fn cycle_status(&mut self) {
        let Some(eid) = self.visible.get(self.sel).map(|n| n.eid.clone()) else { return };
        let Some(row) = self.task_ix.get(&eid) else {
            self.status_msg = "not a task — nothing to move".into();
            return;
        };
        let cur = cstr(row, "task", "status").unwrap_or_default();
        let next = match cur.as_str() {
            "open" => "wip",
            "wip" => "done",
            _ => "open",
        };
        let id = id_of(row);
        let mut comp = Map::new();
        comp.insert("status".into(), Value::from(next));
        let change = Change::new(&eid, "task", Some(comp));
        let opts = ApplyOpts { writer: Some("yak-tui"), fed: false };
        match apply(&self.write, vec![change], &opts, &self.gates) {
            Ok(_) => {
                self.status_msg = format!("{id}: {cur} → {next}");
                // reflect it now; the data_version bump makes this a foreign
                // write to the read conn, so the normal live path picks it up
                self.tick_live();
            }
            Err(e) => {
                let m = e.to_string();
                self.status_msg = format!("write refused: {}", m.lines().next().unwrap_or(&m));
            }
        }
    }

    pub fn refresh(&mut self) {
        let key = self.selected_key();
        self.reload();
        self.rebuild_visible();
        self.restore_selection(key);
    }

    // status-bar facts
    pub fn counts(&self) -> (usize, usize) {
        (self.projects.len(), self.task_ix.len())
    }
}
