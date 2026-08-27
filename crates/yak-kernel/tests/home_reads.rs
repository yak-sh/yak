// Store::deps_of must synthesize the persona `reads` edges (homeReads) the wire
// appends, so `yak show` off a file matches the server byte-for-byte (T-22640).
// A specialist persona's `home` is the one truth; the project→persona `reads`
// edge lives in no table, so a reader off `dependency` alone loses it. This
// holds the rule the kernel now owns: the edge is synthesized, deduped against a
// stored contains/reads edge, quarantine-screened on either end, and never minted
// for a fleet-shared (home-less) persona — and it appears keyed on EITHER end
// (asking the project or asking the persona both surface it).

use rusqlite::Connection;
use yak_kernel::store::Store;
use yak_kernel::vocab::{vocab, PropType};
use yak_kernel::Dep;

fn affinity(t: &PropType) -> &'static str {
    match t {
        PropType::Eid(_) => "integer",
        PropType::Number | PropType::Priority => "real",
        PropType::Bool => "integer",
        _ => "text",
    }
}

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

struct Fixture {
    path: String,
    dir: std::path::PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

// eids by a readable tag so a failure names the actor.
fn eid(tag: &str) -> String {
    format!("aaaaaaaa-0000-4000-8000-{tag:0>12}")
}

// A graph with one project (home) and five personas exercising every arm:
//   pa, pb  — specialists homed at proj → expect a synthetic reads edge
//   pc      — homed at proj BUT already carries a stored `contains` edge → deduped
//   pd      — homed at proj but quarantined → screened out
//   pe      — fleet-shared (home null) → no edge at all
// Plus a plain task with a real `requires` edge, to prove deps_of is otherwise
// untouched (no spurious reads).
fn seed() -> Fixture {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let uniq = SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("yak-homereads-{}-{uniq}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("g.db").to_string_lossy().into_owned();
    let _ = std::fs::remove_file(&path);
    let conn = Connection::open(&path).unwrap();

    let mut schema = String::from(
        "create table entity (id integer primary key, eid text not null unique, num integer unique);\
         create table dependency (parent integer not null, type text not null, child integer not null, ord integer, primary key (parent, type, child));",
    );
    for comp in ["doc", "task", "project", "persona", "quarantined"] {
        schema.push_str(&ddl_for(comp));
    }
    conn.execute_batch(&schema).unwrap();
    conn.execute_batch("begin").unwrap();

    let mut num = 0i64;
    let mut mint = |tag: &str| -> i64 {
        num += 1;
        conn.execute(
            "insert into entity (eid, num) values (?1, ?2)",
            rusqlite::params![eid(tag), num],
        )
        .unwrap();
        conn.last_insert_rowid()
    };

    let proj = mint("proj");
    conn.execute("insert into project (entity) values (?1)", [proj]).unwrap();

    let pa = mint("pa");
    let pb = mint("pb");
    let pc = mint("pc");
    let pd = mint("pd");
    let pe = mint("pe");
    for (id, home) in
        [(pa, Some(proj)), (pb, Some(proj)), (pc, Some(proj)), (pd, Some(proj)), (pe, None)]
    {
        conn.execute(
            "insert into persona (entity, home) values (?1, ?2)",
            rusqlite::params![id, home],
        )
        .unwrap();
    }
    // pc already carries a stored contains edge from its home — no double sentence.
    conn.execute(
        "insert into dependency (parent, type, child) values (?1, 'contains', ?2)",
        rusqlite::params![proj, pc],
    )
    .unwrap();
    // pd is quarantined.
    conn.execute("insert into quarantined (entity) values (?1)", [pd]).unwrap();

    // A plain task tree, wholly unrelated to personas, to prove deps_of is
    // otherwise byte-identical (its edges present, no reads minted).
    let t1 = mint("t1");
    let t2 = mint("t2");
    conn.execute("insert into task (entity, status, priority) values (?1,'open',0)", [t1]).unwrap();
    conn.execute("insert into task (entity, status, priority) values (?1,'open',0)", [t2]).unwrap();
    conn.execute(
        "insert into dependency (parent, type, child) values (?1, 'requires', ?2)",
        rusqlite::params![t1, t2],
    )
    .unwrap();

    conn.execute_batch("commit").unwrap();
    drop(conn);
    Fixture { path, dir }
}

fn store(fx: &Fixture) -> Store {
    Store::open(&fx.path).unwrap()
}

fn has_reads(deps: &[Dep], parent: &str, child: &str) -> bool {
    deps.iter().any(|d| d.type_ == "reads" && d.parent == parent && d.child == child)
}

#[test]
fn deps_of_synthesizes_home_reads() {
    let fx = seed();
    let store = store(&fx);
    let deps = store.deps_of(&eid("proj"));

    // The two clean specialists surface as project→persona reads edges.
    assert!(has_reads(&deps, &eid("proj"), &eid("pa")), "pa reads edge missing");
    assert!(has_reads(&deps, &eid("proj"), &eid("pb")), "pb reads edge missing");

    // pc already has a stored `contains` from proj — no synthetic reads on top.
    assert!(!has_reads(&deps, &eid("proj"), &eid("pc")), "pc got a duplicate reads edge");
    // and its real contains edge is still there.
    assert!(
        deps.iter()
            .any(|d| d.type_ == "contains" && d.parent == eid("proj") && d.child == eid("pc")),
        "pc's stored contains edge vanished"
    );

    // pd is quarantined; pe is fleet-shared (no home) — neither is minted.
    assert!(!has_reads(&deps, &eid("proj"), &eid("pd")), "quarantined persona leaked a reads edge");
    assert!(!has_reads(&deps, &eid("proj"), &eid("pe")), "home-less persona minted a reads edge");
}

#[test]
fn home_reads_surface_keyed_on_the_persona_too() {
    let fx = seed();
    let store = store(&fx);
    // Asking for the persona itself must surface its home's reads edge — the wire
    // keys homeReads on either endpoint, so a persona's card shows it too.
    let deps = store.deps_of(&eid("pa"));
    assert!(has_reads(&deps, &eid("proj"), &eid("pa")), "reads edge absent when keyed on persona");
}

#[test]
fn deps_of_mints_no_spurious_edges_for_a_plain_task() {
    let fx = seed();
    let store = store(&fx);
    let deps = store.deps_of(&eid("t1"));
    // Exactly the one stored requires edge — no reads synthesized for a non-persona.
    assert_eq!(deps.len(), 1, "plain task deps_of changed: {deps:?}");
    assert_eq!(deps[0].type_, "requires");
    assert!(!deps.iter().any(|d| d.type_ == "reads"), "a plain task got a reads edge");
}
