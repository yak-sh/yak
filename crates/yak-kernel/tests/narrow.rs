// The indexed candidate path is a SPEED change that must not move a single row
// (T-22758). This test holds that line the way the bridge's parity harness holds
// it over the wire, but deterministically and in-process: for a battery of
// filters, `store.rows_matching` (narrow-then-refine) must return byte-identical
// rows to the old bulk path `rows_of_kind().filter(matches)`, and `rows_window`
// must equal that set cut to its newest page.
//
// The schema is GENERATED from the kernel's own vocabulary, so a column added to
// a component never drifts this fixture out from under `fill()` (which selects
// every readable column). We seed a controlled graph, then compare.

use rusqlite::Connection;
use yak_kernel::query::{self, Pred};
use yak_kernel::store::{visible, Store};
use yak_kernel::vocab::{vocab, PropType};
use yak_kernel::Row;

// Row is not Serialize; its identity for parity is (eid, num, kind, comps) — and
// comps is a serde Map, so a stable JSON of the tuple is the byte fingerprint.
fn fp(rows: &[Row]) -> String {
    let v: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "eid": r.eid,
                "num": r.num,
                "kind": r.kind,
                "comps": serde_json::Value::Object(r.comps.clone()),
            })
        })
        .collect();
    serde_json::to_string(&v).unwrap()
}

// SQLite affinity for a prop type: a reference holds the target's integer id, a
// number/priority is real, a bool an int, everything else text.
fn affinity(t: &PropType) -> &'static str {
    match t {
        PropType::Eid(_) => "integer",
        PropType::Number | PropType::Priority => "real",
        PropType::Bool => "integer",
        _ => "text",
    }
}

// `create table "comp" (entity integer primary key, "col" <aff>, …)` for every
// readable column the vocabulary declares — so fill()/comp_row() find exactly
// the columns they select.
fn ddl_for(comp: &str) -> String {
    let cols: Vec<String> = vocab()
        .readable(comp)
        .iter()
        .map(|(name, t)| format!("\"{name}\" {}", affinity(t)))
        .collect();
    let body = if cols.is_empty() {
        "entity integer primary key".to_string()
    } else {
        format!("entity integer primary key, {}", cols.join(", "))
    };
    format!("create table \"{comp}\" ({body});")
}

// A seeded read Store over a temp file: write with a RW connection, then open the
// read-only door the bridge uses.
struct Fixture {
    path: String,
    _dir: std::path::PathBuf,
}

impl Fixture {
    fn open(&self) -> Store {
        Store::open(&self.path).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_dir_all(&self._dir);
    }
}

// Build the graph: N tasks cycling through statuses/priorities/projects/titles,
// two real projects to resolve references against, and one quarantined task to
// prove the screen. Returns the fixture.
fn seed(n: usize) -> Fixture {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let uniq = SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("yak-narrow-{}-{uniq}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("g.db").to_string_lossy().into_owned();
    let _ = std::fs::remove_file(&path);
    let conn = Connection::open(&path).unwrap();
    let mut schema = String::from(
        "create table entity (id integer primary key, eid text not null unique, num integer unique);",
    );
    // Generate every comp table (quarantined included — it carries stamped
    // at/by columns fill() selects) from the vocabulary, so nothing drifts.
    for comp in ["doc", "task", "project", "created", "updated", "quarantined"] {
        schema.push_str(&ddl_for(comp));
    }
    conn.execute_batch(&schema).unwrap();
    conn.execute_batch("begin").unwrap(); // one fsync, not one per row

    let eid = |i: usize| format!("eeeeeeee-0000-4000-8000-{i:012}");
    let mut num = 0i64;
    let mut mint = |conn: &Connection, i: usize| -> i64 {
        num += 1;
        conn.execute(
            "insert into entity (eid, num) values (?1, ?2)",
            rusqlite::params![eid(i), num],
        )
        .unwrap();
        conn.last_insert_rowid()
    };

    // two projects
    let mut proj_ids = vec![];
    for i in 0..2 {
        let id = mint(&conn, 900_000 + i);
        conn.execute(
            "insert into doc (entity, title, body) values (?1, ?2, '')",
            rusqlite::params![id, format!("Project {i}")],
        )
        .unwrap();
        conn.execute("insert into project (entity) values (?1)", [id]).unwrap();
        proj_ids.push(id);
    }

    let statuses = &vocab().statuses;
    for i in 0..n {
        let id = mint(&conn, i);
        let title = format!("Task {i} widget");
        conn.execute(
            "insert into doc (entity, title, body) values (?1, ?2, ?3)",
            rusqlite::params![id, title, format!("body of {i}")],
        )
        .unwrap();
        let status = &statuses[i % statuses.len()];
        let priority = (i % 4) as f64;
        let project = proj_ids[i % proj_ids.len()];
        conn.execute(
            "insert into task (entity, status, priority, project) values (?1,?2,?3,?4)",
            rusqlite::params![id, status, priority, project],
        )
        .unwrap();
        conn.execute(
            "insert into created (entity, at) values (?1, ?2)",
            rusqlite::params![id, format!("2026-08-{:02}T00:00:00Z", 1 + (i % 27))],
        )
        .unwrap();
    }
    // one quarantined task, newest num, so a windowed read would grab it first
    let qid = mint(&conn, 999_999);
    conn.execute(
        "insert into doc (entity, title, body) values (?1, 'Quarantined widget', '')",
        [qid],
    )
    .unwrap();
    conn.execute("insert into task (entity, status, priority) values (?1, 'open', 0)", [qid])
        .unwrap();
    conn.execute("insert into quarantined (entity) values (?1)", [qid]).unwrap();

    conn.execute_batch("commit").unwrap();
    drop(conn);
    Fixture { path, _dir: dir }
}

// Parse + resolve a filter line exactly as read.rs does before it hits the store.
fn preds(store: &Store, line: &[&str]) -> (String, Vec<Pred>) {
    let args: Vec<String> = line.iter().map(|s| s.to_string()).collect();
    let (kind, mut ps) = query::parse(&args).unwrap();
    query::resolve_values(store, &mut ps);
    (kind, ps)
}

// The OLD bulk path, kept here as the oracle: fetch the kind, filter in Rust.
fn bulk(store: &Store, kind: &str, ps: &[Pred]) -> Vec<Row> {
    store.rows_of_kind(kind).into_iter().filter(|r| query::matches(r, ps)).collect()
}

fn eids(rows: &[Row]) -> Vec<String> {
    rows.iter().map(|r| r.eid.clone()).collect()
}

// The corpus of filters — each exercises a different compiler arm (enum, list,
// range, numeric compare, reference, contains, presence, absence, `!=`), plus
// mixes with a DECLINING pred (a time phrase) to prove partial narrowing.
const FILTERS: &[&[&str]] = &[
    &[".kind=task"],
    &[".status=open"],
    &[".status=open,wip"],
    &[".status=wip"],
    &[".priority=0"],
    &[".priority<=1"],
    &[".priority=1..3"],
    &[".project=1"], // bare num resolves to the first project's eid (ref arm)
    &[".title~=widget"],
    &[".title~=Task 3 "],
    &[".status!=done"],
    &[".doc!"],
    &[".assignee="],
    &[".status=open", ".updated.at>=today"], // one compiles, one declines
    // a VALID filter that matches nothing — an empty result through the numeric
    // arm. (An out-of-enum status value is no longer a filter that matches
    // nothing: dot_token now validates the value and 400s it, byte-parity with
    // TS parseQuery — T-22759.)
    &[".priority=99"],
];

#[test]
fn narrowed_equals_bulk_for_every_filter() {
    let fx = seed(120);
    let store = fx.open();
    for line in FILTERS {
        let (kind, ps) = preds(&store, line);
        let got = store.rows_narrowed(&kind, &ps);
        let want = bulk(&store, &kind, &ps);
        assert_eq!(eids(&got), eids(&want), "narrowed eids differ from bulk for {line:?}");
        // full-row byte equality, not just eids — the whole point is the SAME row
        assert_eq!(fp(&got), fp(&want), "narrowed ROW bytes differ from bulk for {line:?}");
    }
}

#[test]
fn window_equals_bulk_cut_to_newest_page() {
    let fx = seed(120);
    let store = fx.open();
    let cut = |mut rows: Vec<Row>, limit: usize| -> Vec<Row> {
        rows.sort_by_key(|a| std::cmp::Reverse(a.num.unwrap_or(0)));
        rows.truncate(limit);
        rows.sort_by_key(|a| a.num.unwrap_or(0));
        rows
    };
    // Every EXACT compiler arm runs through the window's no-refine path, so each
    // must be a TRUE match set (a superset marked exact would surface here as an
    // extra row the oracle does not have); plus one inexact line for the Rust
    // fallback.
    for line in [
        &[".status=open"][..],                       // enum =
        &[".status=open,wip"][..],                   // enum list
        &[".priority=1..3"][..],                     // numeric range
        &[".priority<=1"][..],                       // numeric compare
        &[".status!=done"][..],                      // negation + NULL
        &[".title~=widget"][..],                     // contains
        &[".doc!"][..],                              // presence
        &[".assignee="][..],                         // absence
        &[".project=1"][..],                         // reference
        &[".kind=task"][..],                         // no filter (pure window)
        &[".status=open", ".updated.at>=today"][..], // inexact → Rust fallback
    ] {
        let args: Vec<&str> = line.to_vec();
        let (kind, ps) = preds(&store, &args);
        for limit in [1usize, 5, 10] {
            // rows_window screens quarantine (reveal=false); the oracle is the
            // bulk set, screened, then cut to the newest `limit`.
            let want = cut(bulk(&store, &kind, &ps).into_iter().filter(visible).collect(), limit);
            let got = store.rows_window(&kind, &ps, None, Some(limit as i64), false);
            assert_eq!(
                eids(&got),
                eids(&want),
                "window({limit}) differs from bulk-cut for {line:?}"
            );
        }
    }
}

// The scaling proof (T-22758), run on demand:
//   cargo test -p yak-kernel --test narrow -- --ignored --nocapture scaling
// It seeds synthetic kinds of growing size and times the OLD bulk path against
// the two new doors. The bulk read grows with the KIND; the narrowed read grows
// with the RESULT; the windowed read is FLAT — the property the ticket asks for.
#[test]
#[ignore = "timing bench; run explicitly with --ignored --nocapture"]
fn scaling_bench() {
    use std::time::Instant;
    let ms = |f: &dyn Fn()| {
        // best of a few, to shed scheduler noise
        let mut best = f64::MAX;
        for _ in 0..5 {
            let t = Instant::now();
            f();
            best = best.min(t.elapsed().as_secs_f64() * 1000.0);
        }
        best
    };
    println!(
        "\n{:>8}  {:>14}  {:>16}  {:>16}",
        "kind", "bulk(all)", "narrowed(.wip)", "window(limit=1)"
    );
    for n in [1000usize, 4000, 16000] {
        let fx = seed(n);
        let store = fx.open();
        let (_, wip) = preds(&store, &[".status=wip"]);
        let bulk_ms = ms(&|| {
            let _ = store.rows_of_kind("task");
        });
        let narrow_ms = ms(&|| {
            let _ = store.rows_narrowed("task", &wip);
        });
        let window_ms = ms(&|| {
            let _ = store.rows_window("task", &[], None, Some(1), false);
        });
        println!("{n:>8}  {bulk_ms:>12.2}ms  {narrow_ms:>14.2}ms  {window_ms:>14.2}ms");
        // The window read must NOT scale with the kind: at 16k it stays a small
        // fraction of the bulk read it replaces. (A generous bound so scheduler
        // noise never flakes it — the printed numbers show the real gap.)
        if n >= 16000 {
            assert!(
                window_ms < bulk_ms / 4.0,
                "windowed read should not scale with kind size: \
                 window={window_ms:.2}ms bulk={bulk_ms:.2}ms"
            );
        }
    }
}

#[test]
fn window_never_returns_a_quarantined_row() {
    // The quarantined task carries the highest num, so a naive newest-first
    // window would surface it first. The SQL screen must keep it out.
    let fx = seed(30);
    let store = fx.open();
    let (kind, ps) = preds(&store, &[".status=open"]);
    let got = store.rows_window(&kind, &ps, None, Some(50), false);
    assert!(
        got.iter().all(|r| !r.comps.contains_key("quarantined")),
        "a quarantined row leaked into the windowed page"
    );
    // …and reveal=true lets it back in (parity with quarantined=1).
    let revealed = store.rows_window(&kind, &ps, None, Some(50), true);
    assert!(revealed.len() > got.len(), "reveal should surface the screened row");
}
