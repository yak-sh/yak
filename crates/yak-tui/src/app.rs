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

use yak_kernel::store::{collect, Sel};
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

// One rendered log entry: its seq, role, and (control-scrubbed) body.
pub struct EntryLine {
    pub seq: i64,
    pub role: String,
    pub body: String,
}

pub struct App {
    pub db: String,
    store: Store,
    // The read/write split yak-bridge uses: a read-only Store for the Graph
    // projection and the journal feed, a READ_WRITE WriteStore kept ready for
    // the fork write. apply()'s own `begin immediate` is the concurrency
    // discipline, so this holds no long lock. Wired but not yet called — the
    // fork primitive lands on `apply_write` next (T-23975's successor).
    #[allow(dead_code)]
    write: WriteStore,
    #[allow(dead_code)]
    gates: Vec<Box<dyn Gate>>,

    // bulk graph shape
    projects: Vec<Row>,
    repos: Vec<(String, String)>, // (project eid, repo path)
    sessions: Vec<SessionInfo>,   // recency desc
    by_project: HashMap<String, Vec<usize>>,
    actor_name: HashMap<String, String>,

    // the open session's entries
    entries: Vec<EntryLine>,

    // navigation
    pub view: View,
    pub sel: usize,
    stack: Vec<(View, usize)>, // descend history: view + the sel to restore
    pub quit: bool,

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
            view: View::Projects,
            sel: 0,
            stack: vec![],
            quit: false,
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

    // Load a session's entries in seq order — one indexed query over
    // entry(session, seq), joining content/message. Bodies are scrubbed at the
    // boundary before they ever reach a Span.
    fn load_entries(&mut self, session_eid: &str) {
        let sql = "select t.seq, coalesce(m.role, ''), coalesce(c.body, '') \
                   from entry t \
                   left join message m on m.entity = t.entity \
                   left join content c on c.entity = t.entity \
                   where t.session = (select id from entity where eid = ?1) \
                   order by t.seq";
        let rows: Vec<(i64, String, String)> = collect(&self.store.conn, sql, [session_eid], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        });
        self.entries = rows
            .into_iter()
            .map(|(seq, role, body)| EntryLine { seq, role, body: theme::sane(&body, true) })
            .collect();
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

    // The write seam the fork primitive lands on next: one batch through the
    // gated kernel apply(), on the READ_WRITE connection. Wired but unexercised
    // in v0.1 — kept so fork is an additive call here, not a re-plumb.
    #[allow(dead_code)]
    pub fn apply_write(&self, changes: Vec<Change>) -> Result<Vec<Change>, String> {
        let opts = ApplyOpts { writer: Some("yak-tui"), fed: false };
        apply(&self.write, changes, &opts, &self.gates).map_err(|e| e.to_string())
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
