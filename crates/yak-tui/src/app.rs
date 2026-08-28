// The cockpit's state: a project -> recent-sessions -> session/entries drill,
// the current model of an agent run. Reads are bulk and lean — projects and a
// lean projection of every session (no transcript bodies) each in one query,
// bucketed to a project by the same repo-root rule scope_for() uses to resolve
// the cwd. A session's entries load only when it is opened, one indexed query
// over entry(session, seq). Liveness is the journal tail: a cheap data_version
// pragma is the wake (never a fixed-interval scan); a real bump reloads the
// sessions, and the open session's entries.
//
// The WRITE path stays wired for the fork primitive that lands next (T-23975's
// successor): `apply_write` is the seam — the read views never call it yet.

use std::collections::HashMap;

use serde_json::{Map, Value};
use yak_kernel::store::{collect, one, Sel};
use yak_kernel::{
    apply, data_version, default_gates, vocab, ApplyOpts, Change, Feed, Gate, Row, Store,
    WriteStore,
};

use crate::theme;

// Which level of the drill the cockpit is showing.
#[derive(Clone, PartialEq)]
pub enum View {
    Projects,
    Project(String), // project eid
    Session(String), // session eid
}

// A lean session row for the list — the transcript bodies are never loaded here.
pub struct SessionInfo {
    pub eid: String,
    pub id: String, // the human S-num
    pub cwd: String,
    pub agent: String, // provider/model/effort
    pub origin: String,
    pub status: String,
    pub entries: i64, // latest_seq
    pub when: String, // started_at, else finished_at
    pub project: String,
    pub actor: String, // actor eid
}

// One rendered log entry: its own eid (the fork point a fork forks at), seq,
// role, and (control-scrubbed) body, plus which session it belongs to and
// whether it is INHERITED — a shared-prefix line walked from a fork ancestor,
// rendered by reference (never copied into the fork's own entry rows).
pub struct EntryLine {
    pub eid: String,
    pub seq: i64,
    pub role: String,
    pub body: String,
    pub source: String, // the owning session's S-id (for the shared-prefix label)
    pub inherited: bool,
}

pub struct App {
    pub db: String,
    store: Store,
    // The read/write split yak-bridge uses: a read-only Store for the Graph
    // projection and the journal feed, a READ_WRITE WriteStore for the fork
    // write. apply()'s own `begin immediate` is the concurrency discipline, so
    // this holds no long lock. `f` in the session view drives it via apply_write.
    write: WriteStore,
    gates: Vec<Box<dyn Gate>>,

    // bulk graph shape
    projects: Vec<Row>,
    repos: Vec<(String, String)>, // (project eid, repo path)
    sessions: Vec<SessionInfo>,   // recency desc
    by_project: HashMap<String, Vec<usize>>,
    actor_name: HashMap<String, String>,

    // the open session's entries (a forked session's is the walked shared prefix
    // followed by its own entries), and — when the open session is a fork — a
    // one-line origin: "S-parent @ #seq".
    entries: Vec<EntryLine>,
    fork_origin: Option<String>,

    // navigation
    pub view: View,
    pub sel: usize,
    stack: Vec<(View, usize)>, // descend history: view + the sel to restore
    pub quit: bool,
    // The last action's outcome, shown in the footer until the next keystroke
    // moves on — a fork's confirmation, or a durable-enough reason it refused.
    pub flash: Option<String>,

    // liveness
    feed: Feed,
    last_version: i64,
    pub live_events: u64,
}

fn cstr(r: &Row, comp: &str, prop: &str) -> String {
    r.comps
        .get(comp)
        .and_then(|c| c.as_object())
        .and_then(|o| o.get(prop))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn id_of(r: &Row) -> String {
    vocab().id_of(&r.kind, &r.eid, r.num)
}

// A trailing slash off, nothing more — the DB paths are already absolute and
// clean, and this is only ever compared against another path read the same way.
fn clean(p: &str) -> String {
    p.trim_end_matches('/').to_string()
}

// ISO -> "YYYY-MM-DD HH:MM", the human-scannable half.
pub fn short_when(iso: &str) -> String {
    let s: String = iso.chars().take(16).collect();
    s.replace('T', " ")
}

impl App {
    pub fn new(store: Store, write: WriteStore, db: String, cwd: &str) -> App {
        let feed = Feed::from_tip(&store.conn);
        let last_version = data_version(&store.conn);
        let mut app = App {
            db,
            store,
            write,
            gates: default_gates(),
            projects: vec![],
            repos: vec![],
            sessions: vec![],
            by_project: HashMap::new(),
            actor_name: HashMap::new(),
            entries: vec![],
            fork_origin: None,
            view: View::Projects,
            sel: 0,
            stack: vec![],
            quit: false,
            flash: None,
            feed,
            last_version,
            live_events: 0,
        };
        app.reload();
        // Open on the cwd's project (its repo is an ancestor of cwd), seeding
        // the back-stack so `h` returns to the project list positioned on it.
        // The project list otherwise.
        if let Some(p) = app.project_of(cwd) {
            if let Some(i) = app.projects.iter().position(|r| r.eid == p) {
                app.stack.push((View::Projects, i));
                app.view = View::Project(p);
            }
        }
        app
    }

    fn reload(&mut self) {
        self.projects = self.store.rows_of_kind("project");
        self.repos = collect(
            &self.store.conn,
            "select e.eid, r.path from repo r join entity e on e.id = r.entity \
             where r.path is not null",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        );
        self.load_sessions();
    }

    // A lean session projection — id/config/lifecycle only, no transcript body —
    // bucketed to a project by repo-root ancestry, newest first.
    fn load_sessions(&mut self) {
        let sels = [
            Sel {
                comp: "session",
                props: &[
                    "id",
                    "cwd",
                    "provider",
                    "model",
                    "effort",
                    "actor",
                    "origin",
                    "status",
                    "latest_seq",
                    "started_at",
                    "finished_at",
                ],
            },
            Sel { comp: "doc", props: &["title"] },
        ];
        let rows = self.store.rows_of_kind_cols("session", &sels);
        let mut out: Vec<SessionInfo> = rows
            .iter()
            .map(|r| {
                let cwd = cstr(r, "session", "cwd");
                let agent = [
                    cstr(r, "session", "provider"),
                    cstr(r, "session", "model"),
                    cstr(r, "session", "effort"),
                ]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("/");
                let started = cstr(r, "session", "started_at");
                let finished = cstr(r, "session", "finished_at");
                let when = if started.is_empty() { finished } else { started };
                SessionInfo {
                    eid: r.eid.clone(),
                    id: vocab().id_of(&r.kind, &r.eid, r.num),
                    project: self.project_of(&cwd).unwrap_or_default(),
                    cwd,
                    agent,
                    origin: cstr(r, "session", "origin"),
                    status: cstr(r, "session", "status"),
                    entries: r
                        .comps
                        .get("session")
                        .and_then(|c| c.get("latest_seq"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0),
                    when,
                    actor: cstr(r, "session", "actor"),
                }
            })
            .collect();
        out.sort_by(|a, b| b.when.cmp(&a.when));
        self.by_project.clear();
        for (i, s) in out.iter().enumerate() {
            self.by_project.entry(s.project.clone()).or_default().push(i);
        }
        self.sessions = out;
        self.resolve_actor_names();
    }

    // One lean bulk read of the distinct actors, mapped to a display label.
    fn resolve_actor_names(&mut self) {
        let mut actors: Vec<String> =
            self.sessions.iter().map(|s| s.actor.clone()).filter(|a| !a.is_empty()).collect();
        actors.sort();
        actors.dedup();
        self.actor_name.clear();
        for r in self.store.rows_of_faces(&actors) {
            let label = {
                let slug = cstr(&r, "alias", "slug");
                let title = cstr(&r, "doc", "title");
                if !slug.is_empty() {
                    slug
                } else if !title.is_empty() {
                    title
                } else {
                    r.eid.chars().take(8).collect()
                }
            };
            self.actor_name.insert(r.eid.clone(), theme::sane(&label, false));
        }
    }

    // The project whose repo path is an ancestor of `path` (longest wins) — the
    // cheap half of reader::scope_for, replicated so a session buckets by the
    // same rule the cwd open uses. Sessions in external git worktrees that no
    // repo root is an ancestor of fall to the "(unfiled)" bucket.
    fn project_of(&self, path: &str) -> Option<String> {
        let c = clean(path);
        if c.is_empty() {
            return None;
        }
        let mut best: Option<(&str, usize)> = None;
        for (eid, root) in &self.repos {
            let root = clean(root);
            let under = c == root || c.starts_with(&format!("{root}/"));
            if under && best.is_none_or(|(_, n)| root.len() > n) {
                best = Some((eid, root.len()));
            }
        }
        best.map(|(e, _)| e.to_string())
    }

    // Build the open session's FULL transcript. An unforked session is just its
    // own entries in seq order. A forked session's transcript is its shared
    // prefix — the parent's entries up to the fork point — followed by its own,
    // the prefix walked BY REFERENCE (fork.from up the chain, fork-of-fork and
    // all) and never copied. Each ancestor contributes only its entries up to
    // the seq its child forked at; the fork itself contributes all of its own.
    fn load_entries(&mut self, session_eid: &str) {
        self.fork_origin = None;
        // The ancestry newest-first: (session eid, seq cap inclusive). None cap =
        // the whole session (the open fork). A cycle or a detached fork point
        // (from went null) simply stops the walk.
        let mut chain: Vec<(String, Option<i64>)> = vec![(session_eid.to_string(), None)];
        let mut cur = session_eid.to_string();
        for _ in 0..64 {
            let Some(from) = self.fork_from(&cur) else { break };
            let Some((parent, seq)) = self.entry_location(&from) else { break };
            if chain.iter().any(|(e, _)| e == &parent) {
                break; // never loop on a fork that points into its own line
            }
            if self.fork_origin.is_none() {
                self.fork_origin = Some(format!("{} @ #{}", self.session_label(&parent), seq));
            }
            chain.push((parent.clone(), Some(seq)));
            cur = parent;
        }
        // Oldest ancestor first, the open fork last.
        chain.reverse();
        let mut out: Vec<EntryLine> = vec![];
        for (sid, cap) in &chain {
            let label = self.session_label(sid);
            let inherited = sid != session_eid;
            for (eid, seq, role, body) in self.entries_of(sid, *cap) {
                out.push(EntryLine {
                    eid,
                    seq,
                    role,
                    body: theme::sane(&body, true),
                    source: label.clone(),
                    inherited,
                });
            }
        }
        self.entries = out;
    }

    // The fork-point ENTRY this session forked at, if it is a fork (and the
    // point is still alive — a detached fork.from reads as None).
    fn fork_from(&self, session_eid: &str) -> Option<String> {
        self.store
            .comp_row("fork", session_eid)
            .and_then(|m| m.get("from").and_then(|v| v.as_str()).map(String::from))
    }

    // The (session eid, seq) an entry belongs to — one indexed lookup over the
    // entry spine — or None if the entry is gone.
    fn entry_location(&self, entry_eid: &str) -> Option<(String, i64)> {
        one(
            &self.store.conn,
            "select o.eid, t.seq from entry t join entity o on o.id = t.session \
             where t.entity = (select id from entity where eid = ?1)",
            [entry_eid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
    }

    // One session's own entries in seq order, optionally capped at a fork
    // point (seq <= cap) — one indexed query over entry(session, seq).
    fn entries_of(
        &self,
        session_eid: &str,
        cap: Option<i64>,
    ) -> Vec<(String, i64, String, String)> {
        let tail = if cap.is_some() { " and t.seq <= ?2" } else { "" };
        let sql = format!(
            "select o.eid, t.seq, coalesce(m.role, ''), coalesce(c.body, '') \
             from entry t join entity o on o.id = t.entity \
             left join message m on m.entity = t.entity \
             left join content c on c.entity = t.entity \
             where t.session = (select id from entity where eid = ?1){tail} \
             order by t.seq"
        );
        match cap {
            Some(s) => collect(&self.store.conn, &sql, (session_eid, s), |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            }),
            None => collect(&self.store.conn, &sql, [session_eid], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            }),
        }
    }

    // A session's spoken S-id, from the already-loaded list (an ancestor is
    // always a session), else a short eid.
    fn session_label(&self, eid: &str) -> String {
        self.sessions
            .iter()
            .find(|s| s.eid == eid)
            .map(|s| s.id.clone())
            .unwrap_or_else(|| eid.chars().take(8).collect())
    }

    // The open fork's origin line ("S-parent @ #seq"), or None when unforked.
    pub fn fork_origin(&self) -> Option<&str> {
        self.fork_origin.as_deref()
    }

    // --- liveness ---

    pub fn tick_live(&mut self) {
        let v = data_version(&self.store.conn);
        if v == self.last_version {
            return;
        }
        self.last_version = v;
        let mut n = 0u64;
        self.feed.settle(&self.store.conn, &mut |_r| n += 1);
        if n == 0 {
            return;
        }
        self.live_events += n;
        self.reload();
        if let View::Session(eid) = self.view.clone() {
            self.load_entries(&eid);
        }
        self.clamp();
    }

    // --- the current list ---

    // How many rows the current view offers to select over.
    pub fn visible_len(&self) -> usize {
        match &self.view {
            View::Projects => self.project_list().len(),
            View::Project(p) => self.by_project.get(p).map(|v| v.len()).unwrap_or(0),
            View::Session(_) => self.entries.len(),
        }
    }

    // Projects that have at least one session, most-active first, then the
    // "(unfiled)" bucket for sessions no repo root claims.
    pub fn project_list(&self) -> Vec<ProjectRow> {
        let mut rows: Vec<ProjectRow> = self
            .projects
            .iter()
            .filter_map(|r| {
                let n = self.by_project.get(&r.eid).map(|v| v.len()).unwrap_or(0);
                (n > 0).then(|| ProjectRow {
                    eid: r.eid.clone(),
                    id: id_of(r),
                    title: theme::sane(&cstr(r, "doc", "title"), false),
                    sessions: n,
                })
            })
            .collect();
        rows.sort_by_key(|a| std::cmp::Reverse(a.sessions));
        if let Some(v) = self.by_project.get("") {
            if !v.is_empty() {
                rows.push(ProjectRow {
                    eid: String::new(),
                    id: "—".into(),
                    title: "(unfiled)".into(),
                    sessions: v.len(),
                });
            }
        }
        rows
    }

    // The sessions of the project in view, recency order.
    pub fn sessions_in_view(&self) -> Vec<&SessionInfo> {
        let View::Project(p) = &self.view else { return vec![] };
        self.by_project
            .get(p)
            .map(|v| v.iter().map(|&i| &self.sessions[i]).collect())
            .unwrap_or_default()
    }

    pub fn entries_in_view(&self) -> &[EntryLine] {
        &self.entries
    }

    pub fn actor_label(&self, eid: &str) -> String {
        self.actor_name.get(eid).cloned().unwrap_or_else(|| eid.chars().take(8).collect())
    }

    // The session whose header the Session view shows.
    pub fn open_session(&self) -> Option<&SessionInfo> {
        let View::Session(eid) = &self.view else { return None };
        self.sessions.iter().find(|s| &s.eid == eid)
    }

    // The project label for the breadcrumb in a Project view.
    pub fn crumb_project(&self) -> String {
        let View::Project(p) = &self.view else { return String::new() };
        if p.is_empty() {
            return "(unfiled)".into();
        }
        self.projects
            .iter()
            .find(|r| &r.eid == p)
            .map(|r| {
                let t = theme::sane(&cstr(r, "doc", "title"), false);
                if t.is_empty() {
                    id_of(r)
                } else {
                    format!("{} {}", id_of(r), t)
                }
            })
            .unwrap_or_else(|| p.chars().take(8).collect())
    }

    // --- navigation ---

    fn clamp(&mut self) {
        let n = self.visible_len();
        if self.sel >= n {
            self.sel = n.saturating_sub(1);
        }
    }

    pub fn down(&mut self) {
        if self.sel + 1 < self.visible_len() {
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
        self.sel = self.visible_len().saturating_sub(1);
    }

    // `l`/enter: descend into the selected row.
    pub fn enter(&mut self) {
        match &self.view {
            View::Projects => {
                let list = self.project_list();
                let Some(p) = list.get(self.sel) else { return };
                let eid = p.eid.clone();
                self.stack.push((View::Projects, self.sel));
                self.view = View::Project(eid);
                self.sel = 0;
            }
            View::Project(_) => {
                let sessions = self.sessions_in_view();
                let Some(s) = sessions.get(self.sel) else { return };
                let eid = s.eid.clone();
                let here = self.view.clone();
                self.stack.push((here, self.sel));
                self.load_entries(&eid);
                self.view = View::Session(eid);
                self.sel = 0;
            }
            View::Session(_) => {}
        }
    }

    // `h`/Ctrl-D: back out to the parent view, restoring where the cursor was.
    pub fn back(&mut self) {
        if let Some((view, sel)) = self.stack.pop() {
            self.view = view;
            self.sel = sel;
        } else if !matches!(self.view, View::Projects) {
            // opened straight onto a project with no history: fall to the list
            self.view = View::Projects;
            self.sel = 0;
        }
    }

    pub fn refresh(&mut self) {
        self.reload();
        if let View::Session(eid) = self.view.clone() {
            self.load_entries(&eid);
        }
        self.clamp();
    }

    // The write seam: one batch through the gated kernel apply() on the
    // READ_WRITE connection. apply()'s own `begin immediate` queues politely
    // behind the server's short batches, so this holds no long lock.
    pub fn apply_write(&self, changes: Vec<Change>) -> Result<Vec<Change>, String> {
        let opts = ApplyOpts { writer: Some("yak-tui"), fed: false };
        apply(&self.write, changes, &opts, &self.gates).map_err(|e| e.to_string())
    }

    // Fork the open session at the SELECTED entry (`f`). Mints a new session
    // wearing fork{from: <that entry>}, inheriting the parent's cwd/actor so the
    // fork files under the same project and speaks as the same actor, then
    // reloads and descends into it. The parent's entries up to the fork point are
    // the shared prefix BY REFERENCE — no entry row is copied. A coarse,
    // additive branch: entry{session, seq} is untouched, so nothing else changes.
    pub fn fork_here(&mut self) -> Result<(), String> {
        if !matches!(self.view, View::Session(_)) {
            return Ok(());
        }
        let Some(entry) = self.entries.get(self.sel) else { return Ok(()) };
        let from = entry.eid.clone();
        let seq = entry.seq;
        let parent = self.open_session().ok_or("no open session")?;
        let cwd = parent.cwd.clone();
        let actor = parent.actor.clone();
        let plabel = parent.id.clone();

        let new_eid = uuid::Uuid::new_v4().to_string();
        let mut session = Map::new();
        // A synthesized, unique handle — the human id stays the minted S-num.
        session.insert("id".into(), Value::from(format!("fork:{new_eid}")));
        if !cwd.is_empty() {
            session.insert("cwd".into(), Value::from(cwd));
        }
        if !actor.is_empty() {
            session.insert("actor".into(), Value::from(actor));
        }
        session.insert("source".into(), Value::from("fork"));
        let mut doc = Map::new();
        doc.insert("title".into(), Value::from(format!("fork of {plabel} @ #{seq}")));
        let mut fork = Map::new();
        fork.insert("from".into(), Value::from(from));

        self.apply_write(vec![
            Change::new(&new_eid, "session", Some(session)),
            Change::new(&new_eid, "doc", Some(doc)),
            Change::new(&new_eid, "fork", Some(fork)),
        ])?;

        // Surface the fresh session, then descend into it — its transcript is the
        // walked shared prefix followed by (as yet) no entries of its own.
        self.reload();
        let here = self.view.clone();
        self.stack.push((here, self.sel));
        self.load_entries(&new_eid);
        let label = self.session_label(&new_eid);
        self.view = View::Session(new_eid);
        self.sel = 0;
        self.flash = Some(format!("forked {plabel} @ #{seq} → {label}"));
        Ok(())
    }

    pub fn counts(&self) -> (usize, usize) {
        (self.projects.len(), self.sessions.len())
    }
}

// A project as the Projects view lists it.
pub struct ProjectRow {
    pub eid: String,
    pub id: String,
    pub title: String,
    pub sessions: usize,
}
