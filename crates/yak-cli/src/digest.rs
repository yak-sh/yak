// The boot digest (client.ts contextDigest + sessionMeta), read straight off
// the file: claimed work with unresolved gates, the recent past, the project
// pulse, decisions, fleet memory — ≤48 lines by construction. READ-ONLY: the
// `## pending messages` bus block is absent on purpose (serving it stamps
// `notified`, a write that belongs to the write-capable doors).

use yak_kernel::query;
use yak_kernel::reader::{self, Reader};
use yak_kernel::store::{Row, Rows, Sel};
use yak_kernel::{vocab, Store};

use crate::render::{authoring_line, claimant, id_of};

const DAY: i64 = 86_400_000;

// The comps each digest section actually renders — the projection every
// bulk/single read below pulls instead of all ~125 comp tables (T-22823).
// Each list names its rendered comps AND the comps kind_of/visible() read: a
// `design` presence flips a task's id to D-, and `quarantined` is the screen
// every listing applies. `doc` is title-only everywhere but the comment
// section, which quotes the body — a digest names titles, never bodies.

// A task LINE: id/status/priority/project, title, the authoring line
// (created/proposed/decided), and the claim + resume-stack signals.
const TASK_SELS: &[Sel] = &[
    Sel { comp: "task", props: &[] },
    Sel { comp: "doc", props: &["title"] },
    Sel { comp: "created", props: &[] },
    Sel { comp: "updated", props: &[] },
    Sel { comp: "proposed", props: &[] },
    Sel { comp: "decided", props: &[] },
    Sel { comp: "claim", props: &[] },
    Sel { comp: "resume", props: &[] },
    Sel { comp: "design", props: &[] },
    Sel { comp: "quarantined", props: &[] },
];

// A session row: its meta (session + its canonical facets
// project_session folds in), the brief the `previously` block quotes, its
// title and timestamps.
const SESSION_SELS: &[Sel] = &[
    Sel { comp: "session", props: &[] },
    Sel { comp: "spawn", props: &[] },
    Sel { comp: "worktree", props: &[] },
    Sel { comp: "runtime", props: &[] },
    Sel { comp: "run", props: &[] },
    Sel { comp: "settled", props: &[] },
    Sel { comp: "yield", props: &[] },
    Sel { comp: "brief", props: &[] },
    Sel { comp: "doc", props: &["title"] },
    Sel { comp: "created", props: &[] },
    Sel { comp: "updated", props: &[] },
    Sel { comp: "quarantined", props: &[] },
];

// A fleet memory: its title, the recall stamps `hot()` scores, the memory/
// feedback marks the line prints.
const MEMORY_SELS: &[Sel] = &[
    Sel { comp: "memory", props: &[] },
    Sel { comp: "recall", props: &[] },
    Sel { comp: "feedback", props: &[] },
    Sel { comp: "doc", props: &["title"] },
    Sel { comp: "created", props: &[] },
    Sel { comp: "updated", props: &[] },
    Sel { comp: "quarantined", props: &[] },
];

// A decided entity — task, design, memory, persona or project — so belongs()
// and the id prefix both need every kind-defining comp it might wear.
const DECIDED_SELS: &[Sel] = &[
    Sel { comp: "decided", props: &[] },
    Sel { comp: "doc", props: &["title"] },
    Sel { comp: "task", props: &[] },
    Sel { comp: "memory", props: &[] },
    Sel { comp: "persona", props: &[] },
    Sel { comp: "project", props: &[] },
    Sel { comp: "design", props: &[] },
    Sel { comp: "quarantined", props: &[] },
];

// A comment on your work: its target, who wrote it, any review verdict, and
// the body first line the line quotes.
const COMMENT_SELS: &[Sel] = &[
    Sel { comp: "comment", props: &[] },
    Sel { comp: "doc", props: &["body"] },
    Sel { comp: "created", props: &[] },
    Sel { comp: "review", props: &[] },
    Sel { comp: "quarantined", props: &[] },
];

// A face named by a line — its id (kind → prefix) and title.
const FACE_SELS: &[Sel] = &[
    Sel { comp: "doc", props: &["title"] },
    Sel { comp: "persona", props: &[] },
    Sel { comp: "project", props: &[] },
    Sel { comp: "quarantined", props: &[] },
];

// The scope project in the H1: its title, and the kind for its P- prefix.
const HERE_SELS: &[Sel] = &[
    Sel { comp: "doc", props: &["title"] },
    Sel { comp: "project", props: &[] },
    Sel { comp: "quarantined", props: &[] },
];

fn s(v: Option<&serde_json::Value>) -> String {
    match v {
        Some(serde_json::Value::String(x)) => x.clone(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        Some(serde_json::Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

fn comp<'a>(r: &'a Row, c: &str, p: &str) -> Option<&'a serde_json::Value> {
    r.comps.get(c)?.as_object()?.get(p)
}

fn cs(r: &Row, c: &str, p: &str) -> String {
    s(comp(r, c, p))
}

fn settled(status: &str) -> bool {
    status == "done" || status == "cancelled"
}

fn snip(x: &str) -> String {
    let n = 72;
    if x.chars().count() > n {
        format!("{}…", x.chars().take(n).collect::<String>())
    } else {
        x.into()
    }
}

fn born_at(r: &Row) -> String {
    cs(r, "created", "at")
}
fn edited_at(r: &Row) -> String {
    let u = cs(r, "updated", "at");
    if u.is_empty() {
        born_at(r)
    } else {
        u
    }
}

fn title_of(r: &Row) -> String {
    cs(r, "doc", "title")
}

fn status_of(r: &Row) -> String {
    cs(r, "task", "status")
}

// every eid wearing a comp, projected to the comps `sels` names
fn rows_wearing(store: &Store, comp: &str, sels: &[Sel]) -> Vec<Row> {
    if !store.has_table(comp) {
        return vec![];
    }
    let sql = format!(
        "select e.eid from \"{comp}\" t join entity e on e.id = t.entity \
         order by e.num"
    );
    let Ok(mut st) = store.conn.prepare(&sql) else { return vec![] };
    let eids: Vec<String> = st
        .query_map([], |r| r.get(0))
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    store.rows_of_cols(&eids, sels).into_iter().filter(yak_kernel::store::visible).collect()
}

// The actor's BRIEFED sessions — those the `previously` block can ever pick.
// `previously` scans the actor's sessions for the newest one carrying a brief
// (brief.text, or session.final_text as the fallback brief_of() reads), so a
// session wearing neither is filtered out no matter how recent. Loading only
// the briefed ones is therefore output-identical to loading all ~1500 of them,
// and it is what lets the digest read a handful of rows instead of the whole
// actor history (T-22787). The membership is the same reverse-ref the full
// path walked (session.actor = actor), screened to a brief being present.
fn briefed_session_eids(store: &Store, actor: &str) -> Vec<String> {
    if !store.has_table("session") {
        return vec![];
    }
    let brief_present = if store.has_table("brief") {
        "or exists (select 1 from brief b \
         where b.entity = s.entity and coalesce(b.text, '') <> '')"
    } else {
        ""
    };
    let sql = format!(
        "select e.eid from session s \
         join entity e on e.id = s.entity \
         join entity a on a.id = s.actor \
         where a.eid = ?1 and (coalesce(s.final_text, '') <> '' {brief_present}) \
         order by e.num"
    );
    let Ok(mut st) = store.conn.prepare(&sql) else { return vec![] };
    st.query_map([actor], |r| r.get(0))
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default()
}

// memories with NO scope — the fleet's shared principles
fn fleet_memories(store: &Store) -> Vec<Row> {
    if !store.has_table("memory") {
        return vec![];
    }
    let sql = "select e.eid from memory t join entity e on e.id = t.entity \
               where t.scope is null order by e.num";
    let Ok(mut st) = store.conn.prepare(sql) else { return vec![] };
    let eids: Vec<String> = st
        .query_map([], |r| r.get(0))
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    store.rows_of_cols(&eids, MEMORY_SELS).into_iter().filter(yak_kernel::store::visible).collect()
}

// query.ts hot(): recency curve over the recall stamps
fn hot(r: &Row, now: i64) -> f64 {
    let mut count = comp(r, "recall", "count").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let mut last = yak_kernel::time::parse_stamp(&cs(r, "recall", "last_at"));
    if count == 0.0 || last.is_none() {
        count = 1.0;
        let at = edited_at(r);
        last = yak_kernel::time::parse_stamp(&at);
        if last.is_none() {
            return 0.0;
        }
    }
    let last = last.unwrap();
    let first = yak_kernel::time::parse_stamp(&cs(r, "recall", "first_at")).unwrap_or(last);
    let mean = if count > 1.0 { ((last - first).max(0)) as f64 / (count - 1.0) } else { 0.0 };
    let stability = DAY as f64 * count * (1.0 + mean / (7.0 * DAY as f64));
    (-((now - last).max(0) as f64) / stability).exp()
}

fn verdict_name(v: &str) -> String {
    v.replace('_', " ")
}

// taskBlock: the task line plus its unresolved gates
fn task_block(store: &Store, rows: &Rows, r: &Row, lines: &mut Vec<String>) {
    let authoring = authoring_line(rows, r);
    let head = format!(
        "- {} {} — {}{}",
        id_of(r),
        if status_of(r).is_empty() { r.kind.clone() } else { status_of(r) },
        title_of(r),
        if authoring.is_empty() { String::new() } else { format!(" · {authoring}") }
    );
    lines.push(head);
    for d in store.deps_of(&r.eid) {
        if d.parent != r.eid || d.type_ == "reads" {
            continue;
        }
        let Some(c) = rows.get(&d.child) else { continue };
        if settled(&status_of(&c)) {
            continue;
        }
        let who = claimant(rows, &c);
        lines.push(format!(
            "  - {} → {} ({}{})",
            d.type_,
            id_of(&c),
            if status_of(&c).is_empty() { c.kind.clone() } else { status_of(&c) },
            who.map(|w| format!(", ⚑ {w}")).unwrap_or_default()
        ));
    }
}

// Pre-load the faces the coming lines name — an authoring by/via, a claimant's
// session, a dependency child (its own status/claimant/id), a comment's target
// and author — so each resolves from one projected bulk read instead of a full
// per-eid probe (T-22823). task_block's dep sub-lines were the worst offender:
// one full ~125-table row() per edge, per rendered task. The waves fan out —
// a dep child names its claiming session, a session names its persona — and a
// miss still resolves through get(), so this only ever trades probes for speed.
fn warm_faces(store: &Store, rows: &Rows, subjects: &[&Row]) {
    // wave one: the refs the subjects carry, plus the children of their
    // dependency edges (the same edges task_block renders).
    let mut frontier: Vec<String> = subjects.iter().flat_map(|r| face_refs(r)).collect();
    for r in subjects {
        for d in store.deps_of(&r.eid) {
            if d.parent == r.eid && d.type_ != "reads" {
                frontier.push(d.child.clone());
            }
        }
    }
    // three waves reach every face a digest line resolves: subject → dep child
    // / authoring face → claiming session → persona.
    for _ in 0..3 {
        rows.warm_faces(store, &frontier);
        let next: Vec<String> = frontier
            .iter()
            .filter_map(|e| rows.get(e))
            .flat_map(|r| {
                let mut v = face_refs(&r);
                let p = cs(&r, "session", "persona");
                if !p.is_empty() {
                    v.push(p);
                }
                v
            })
            .collect();
        if next.is_empty() {
            break;
        }
        frontier = next;
    }
}

// The reference eids a row names on a digest line: its authoring faces, a
// claiming session, a comment's target.
fn face_refs(r: &Row) -> Vec<String> {
    [
        ("created", "by"),
        ("created", "via"),
        ("proposed", "by"),
        ("proposed", "via"),
        ("decided", "by"),
        ("decided", "via"),
        ("claim", "session"),
        ("comment", "target"),
    ]
    .iter()
    .map(|(c, p)| cs(r, c, p))
    .filter(|v| !v.is_empty())
    .collect()
}

// belongs(): does a row belong to the scope, each kind its own way
fn belongs(r: &Row, scope: &str) -> bool {
    if scope.is_empty() {
        return true;
    }
    if r.comps.contains_key("task") {
        return cs(r, "task", "project") == scope;
    }
    if r.comps.contains_key("memory") {
        let sc = cs(r, "memory", "scope");
        return sc.is_empty() || sc == scope;
    }
    if r.comps.contains_key("persona") {
        return cs(r, "persona", "home") == scope;
    }
    if r.comps.contains_key("project") {
        return r.eid == scope;
    }
    true
}

fn brief_of(r: &Row) -> String {
    let b = cs(r, "brief", "text");
    if !b.is_empty() {
        return b;
    }
    cs(r, "session", "final_text")
}

// The session's meta as YAML frontmatter (client.ts sessionMeta).
pub fn session_meta(store: &Store, sid: &str) -> String {
    let Some(sess) = store.session_row_cols(sid, SESSION_SELS) else {
        return String::new();
    };
    let persona_eid = cs(&sess, "session", "persona");
    let persona = (!persona_eid.is_empty())
        .then(|| store.row_cols(&persona_eid, FACE_SELS))
        .flatten()
        .map(|p| format!("{} {}", id_of(&p), title_of(&p)).trim().to_string());
    let mut meta: Vec<(&str, String)> = vec![
        ("session", id_of(&sess)),
        ("sid", sid.into()),
        ("provider", cs(&sess, "session", "provider")),
        ("model", cs(&sess, "session", "model")),
        ("effort", cs(&sess, "session", "effort")),
        ("cwd", cs(&sess, "session", "cwd")),
    ];
    if let Some(p) = persona {
        meta.push(("persona", p));
    }
    let mut out = vec!["---".to_string()];
    for (k, v) in meta {
        if !v.is_empty() {
            out.push(format!("{k}: {v}"));
        }
    }
    out.push("---".into());
    out.join("\n")
}

// contextDigest, read off the file. `scope_arg` mirrors the TS callers:
// the preview passes its resolved repo/project, a session resolves its own.
pub fn context_digest(
    store: &Store,
    session: Option<&str>,
    now: i64,
    scope_arg: Option<&str>,
) -> String {
    let v = vocab();
    let rows = Rows::new(store);
    let sess = session.and_then(|sid| store.session_row_cols(sid, SESSION_SELS));
    let cwd = sess.as_ref().map(|r| cs(r, "session", "cwd")).unwrap_or_default();
    let scope = match scope_arg {
        Some(x) => Some(x.to_string()),
        None => reader::scope_for(store, sess.as_ref(), &cwd, None),
    };
    let scope_s = scope.clone().unwrap_or_default();
    let here = scope.as_ref().and_then(|e| store.row_cols(e, HERE_SELS));
    let tasks: Vec<Row> = store
        .rows_of_kind_cols("task", TASK_SELS)
        .into_iter()
        .filter(yak_kernel::store::visible)
        .collect();
    let actor = sess
        .as_ref()
        .map(|r| cs(r, "session", "actor"))
        .filter(|a| !a.is_empty())
        .or_else(|| scope.clone());
    // the sessions the digest actually reads — NOT the actor's whole history
    // (~1500 rows to render ≤5). Two consumers, each with a bounded need
    // (T-22787): `previously` picks the newest BRIEFED session, so it needs
    // only briefed_session_eids; `resumptions` maps a candidate task's claim
    // to its holder's actor, so it needs only the sessions HOLDING a claim on
    // an open task. Their union is output-identical to the full load — a
    // session in neither set was never read on either path. The
    // previously-thread's actor falls back to the SCOPE (actor == project
    // since T-19461), so a bare preview still shows the thread.
    let sessions: Vec<Row> = match &actor {
        Some(a) => {
            let mut want: Vec<String> = briefed_session_eids(store, a);
            for t in &tasks {
                if settled(&status_of(t)) {
                    continue;
                }
                let holder = cs(t, "claim", "session");
                if !holder.is_empty() {
                    want.push(holder);
                }
            }
            want.sort();
            want.dedup();
            // The full path returned rows num-ascending (eids_where_ref orders
            // by num); `previously` stable-sorts by edited_at, so equal-time
            // ties break on that order. Restore it — an eid-keyed set loaded in
            // >500-eid chunks would otherwise not be globally num-sorted.
            let mut rows = store.rows_of_cols(&want, SESSION_SELS);
            rows.sort_by_key(|r| r.num.unwrap_or(0));
            rows
        }
        None => vec![],
    };
    // my claims: entities wearing claim.session = my session entity
    let mut mine: Vec<Row> = match &sess {
        Some(sr) => store.rows_of_cols(
            &store.eids_where_ref("claim", "session", std::slice::from_ref(&sr.eid)),
            TASK_SELS,
        ),
        None => vec![],
    };
    mine.sort_by_key(|a| std::cmp::Reverse(cs(a, "claim", "claimed_at")));
    let mut lines: Vec<String> = vec![format!(
        "# {}{}",
        match session {
            Some(sid) => format!("tasks · session {sid}"),
            None => "tasks · a preview".into(),
        },
        here.as_ref().map(|h| format!(" · {} {}", id_of(h), title_of(h))).unwrap_or_default()
    )];
    if !mine.is_empty() {
        lines.push("claimed by you:".into());
        let subj: Vec<&Row> = mine.iter().take(4).collect();
        warm_faces(store, &rows, &subj);
        for r in subj {
            task_block(store, &rows, r, &mut lines);
        }
    } else {
        let open: Vec<&Row> = tasks
            .iter()
            .filter(|r| !settled(&status_of(r)))
            .filter(|r| !r.comps.contains_key("claim"))
            .collect();
        let mut local: Vec<&Row> = if scope.is_some() {
            open.iter().copied().filter(|r| belongs(r, &scope_s)).collect()
        } else {
            open.clone()
        };
        if local.is_empty() {
            local = open;
        }
        lines.push(format!(
            "nothing claimed. open work{}, board order:",
            if here.is_some() { " here" } else { "" }
        ));
        local.sort_by(|a, b| query::by_board(a, b));
        let picks: Vec<Row> = local.iter().take(5).map(|r| (*r).clone()).collect();
        let subj: Vec<&Row> = picks.iter().collect();
        warm_faces(store, &rows, &subj);
        for r in &picks {
            task_block(store, &rows, r, &mut lines);
        }
    }
    // the unread count, preview only — the inbox's own predicate
    if session.is_none() {
        let who: Reader = yak_kernel::reader::reader_for(store, None, &cwd, scope.as_deref());
        let unread =
            yak_kernel::inbox::inbox_rows(store, &who, &[], yak_kernel::inbox::Mode::Inbox)
                .into_iter()
                .filter(|r| yak_kernel::reader::inbox_item(&who, r))
                .filter(yak_kernel::reader::is_unread)
                .count();
        if unread > 0 {
            lines.push(format!("## inbox — {unread} unread (task inbox)"));
        }
    }
    // resume — pop your stack
    let budget = 5.min(48 - lines.len() as i64);
    resumptions(store, &tasks, &sessions, &sess, budget, &mut lines);
    // previously — the newest brief by the same operator
    if let Some(a) = &actor {
        let mut briefed: Vec<&Row> = sessions
            .iter()
            .filter(|r| {
                Some(&r.eid) != sess.as_ref().map(|s| &s.eid)
                    && cs(r, "session", "actor") == *a
                    && !brief_of(r).is_empty()
            })
            .collect();
        briefed.sort_by_key(|x| std::cmp::Reverse(edited_at(x)));
        let prev = briefed
            .iter()
            .find(|r| yak_kernel::reader::truthy(comp(r, "session", "operator")))
            .or(briefed.first());
        if let Some(prev) = prev {
            let title = snip(&title_of(prev));
            lines.push(format!(
                "## previously — {}{}",
                id_of(prev),
                if title.is_empty() { String::new() } else { format!(" {title}") }
            ));
            let told: Vec<String> = brief_of(prev)
                .lines()
                .map(|l| l.trim_end().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            for l in told.iter().take(18) {
                lines.push(format!("> {l}"));
            }
            if told.len() > 18 {
                lines.push(format!("> … → `task show {}` for the rest", id_of(prev)));
            }
        }
    }
    // on your tasks (session layer)
    let room = |lines: &Vec<String>| 48i64 - lines.len() as i64;
    if let Some(sr) = &sess {
        let budget = 4.min(room(&lines));
        on_mine(store, &rows, sr, now, budget, &mut lines);
    }
    pulse(&tasks, now, room(&lines), &scope_s, here.is_some(), &mut lines);
    decisions(store, room(&lines).min(6), &scope_s, &mut lines);
    fleet_memory(store, now, room(&lines).min(6), &mut lines);
    lines.push(format!(
        "claim: `task claim <id> {}` · comment: `task comment <id> \"…\"` · release when done or handing off",
        session.unwrap_or("<session>")
    ));
    let _ = v;
    lines.truncate(48);
    lines.join("\n")
}

fn resumptions(
    store: &Store,
    tasks: &[Row],
    sessions: &[Row],
    sess: &Option<Row>,
    budget: i64,
    lines: &mut Vec<String>,
) {
    // the actor is the SESSION's — a bare preview holds no stack
    let Some(actor) = sess.as_ref().map(|r| cs(r, "session", "actor")).filter(|a| !a.is_empty())
    else {
        return;
    };
    if budget < 2 {
        return;
    }
    let mine: std::collections::HashSet<String> = match sess {
        Some(sr) => store
            .eids_where_ref("claim", "session", std::slice::from_ref(&sr.eid))
            .into_iter()
            .collect(),
        None => Default::default(),
    };
    let by_eid: std::collections::HashMap<&str, &Row> =
        sessions.iter().map(|r| (r.eid.as_str(), r)).collect();
    let at = |r: &Row| {
        let x = cs(r, "resume", "at");
        if !x.is_empty() {
            return x;
        }
        let c = cs(r, "claim", "claimed_at");
        if !c.is_empty() {
            c
        } else {
            edited_at(r)
        }
    };
    let mut hits: Vec<&Row> = tasks
        .iter()
        .filter(|r| !settled(&status_of(r)))
        .filter(|r| !mine.contains(&r.eid))
        .filter(|r| {
            if r.comps.contains_key("claim") {
                // .claim.session.actor = actor — one deref through sessions
                let sid = cs(r, "claim", "session");
                return by_eid
                    .get(sid.as_str())
                    .map(|s| cs(s, "session", "actor") == actor)
                    .unwrap_or(false);
            }
            cs(r, "resume", "actor") == actor
                || cs(r, "updated", "by") == actor
                || cs(r, "created", "by") == actor
        })
        .collect();
    hits.sort_by(|a, b| {
        let rank = |r: &Row| comp(r, "resume", "rank").and_then(|v| v.as_f64()).unwrap_or(0.0);
        rank(b).partial_cmp(&rank(a)).unwrap_or(std::cmp::Ordering::Equal).then(at(b).cmp(&at(a)))
    });
    let hits: Vec<&&Row> = hits.iter().take((budget - 1) as usize).collect();
    if hits.is_empty() {
        return;
    }
    lines.push("## resume — pop your stack".into());
    for r in hits {
        let holder = by_eid.get(cs(r, "claim", "session").as_str());
        let held = holder.map(|h| format!(" · ⚑ {}", id_of(h))).unwrap_or_default();
        lines.push(format!("- {} {}{} — {}", id_of(r), status_of(r), held, snip(&title_of(r))));
    }
}

fn on_mine(store: &Store, rows: &Rows, sess: &Row, now: i64, budget: i64, lines: &mut Vec<String>) {
    if budget < 1 {
        return;
    }
    let mine: Vec<String> =
        store.eids_where_ref("claim", "session", std::slice::from_ref(&sess.eid));
    if mine.is_empty() {
        return;
    }
    let mut hits: Vec<Row> = store
        .rows_of_cols(&store.eids_where_ref("comment", "target", &mine), COMMENT_SELS)
        .into_iter()
        .filter(|r| {
            cs(r, "created", "via") != sess.eid
                && yak_kernel::time::parse_stamp(&born_at(r))
                    .map(|t| now - t < 7 * DAY)
                    .unwrap_or(false)
        })
        .collect();
    hits.sort_by_key(|a| std::cmp::Reverse(born_at(a)));
    let hits: Vec<Row> = hits.into_iter().take(budget as usize).collect();
    if hits.is_empty() {
        return;
    }
    lines.push("## on your tasks".into());
    warm_faces(store, rows, &hits.iter().collect::<Vec<_>>());
    for r in &hits {
        let target = cs(r, "comment", "target");
        let target_row = rows.get(&target);
        let by = {
            let who = cs(r, "created", "by");
            let who = if who.is_empty() { cs(r, "created", "via") } else { who };
            rows.get(&who)
                .map(|w| {
                    let alias = cs(&w, "alias", "slug");
                    if !alias.is_empty() {
                        return alias;
                    }
                    let t = title_of(&w);
                    if !t.is_empty() {
                        return t;
                    }
                    cs(&w, "session", "id")
                })
                .filter(|x| !x.is_empty())
                .unwrap_or_else(|| "someone".into())
        };
        let body: String =
            cs(r, "doc", "body").lines().next().unwrap_or("").chars().take(96).collect();
        let verdict = verdict_name(&cs(r, "review", "verdict"));
        let words = if verdict.trim().is_empty() { body } else { format!("[{verdict}] {body}") };
        lines.push(format!(
            "- {} 💬 {by}: {words}",
            target_row.map(|t| id_of(&t)).unwrap_or(target)
        ));
    }
}

fn pulse(tasks: &[Row], now: i64, budget: i64, scope: &str, scoped: bool, lines: &mut Vec<String>) {
    if budget < 2 {
        return;
    }
    let cutoff = now - 7 * DAY;
    let fresh =
        |r: &Row| yak_kernel::time::parse_stamp(&edited_at(r)).map(|t| t > cutoff).unwrap_or(false);
    let mut mine: Vec<&Row> = if scoped {
        tasks.iter().filter(|r| cs(r, "task", "project") == scope && fresh(r)).collect()
    } else {
        tasks.iter().filter(|r| !settled(&status_of(r)) && fresh(r)).collect()
    };
    mine.sort_by_key(|a| std::cmp::Reverse(edited_at(a)));
    let cap = ((budget - 1) as usize).min(if scoped { 6 } else { 3 });
    let hits: Vec<&&Row> = mine.iter().take(cap).collect();
    if hits.is_empty() {
        return;
    }
    lines.push(if scoped { "## lately" } else { "## fleet — nowhere placed" }.into());
    for r in hits {
        lines.push(format!("- {} {} — {}", id_of(r), status_of(r), snip(&title_of(r))));
    }
}

fn decisions(store: &Store, budget: i64, scope: &str, lines: &mut Vec<String>) {
    if budget < 2 {
        return;
    }
    let mut hits: Vec<Row> = rows_wearing(store, "decided", DECIDED_SELS)
        .into_iter()
        .filter(|r| belongs(r, scope))
        .collect();
    hits.sort_by_key(|a| std::cmp::Reverse(cs(a, "decided", "at")));
    let hits: Vec<Row> = hits.into_iter().take((budget - 1) as usize).collect();
    if hits.is_empty() {
        return;
    }
    lines.push("## decided".into());
    for r in &hits {
        let at: String = cs(r, "decided", "at").chars().take(10).collect();
        lines.push(format!("- {at} {} — {}", id_of(r), snip(&title_of(r))));
    }
}

fn fleet_memory(store: &Store, now: i64, budget: i64, lines: &mut Vec<String>) {
    if budget < 3 {
        return;
    }
    let mut mems: Vec<(Row, f64)> = fleet_memories(store)
        .into_iter()
        .map(|r| {
            let h = hot(&r, now);
            (r, h)
        })
        .collect();
    mems.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let mems: Vec<(Row, f64)> = mems.into_iter().take((budget - 1) as usize).collect();
    if mems.is_empty() {
        return;
    }
    lines.push(
        "## from the fleet — read any that fit (MCP memory_recall / CLI task show <id>), adopt what helps"
            .into(),
    );
    for (r, score) in &mems {
        let head = if r.comps.contains_key("feedback") { "feedback: " } else { "" };
        let n = comp(r, "recall", "count").and_then(|v| v.as_i64()).unwrap_or(0);
        let seen = {
            let c = cs(r, "memory", "last_confirmed_at");
            if c.is_empty() {
                String::new()
            } else {
                format!(" · confirmed {}", c.chars().take(10).collect::<String>())
            }
        };
        lines.push(format!(
            "- {} {score:.2} {head}{}{}{seen}",
            id_of(r),
            title_of(r),
            if n > 0 { format!(" · {n}×") } else { String::new() }
        ));
    }
}
