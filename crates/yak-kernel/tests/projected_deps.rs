// A projected edge selector reads stored dependency sentences through indexed
// endpoint ownership, then collapses their endpoints. Session citations are the
// motivating case: many entry→referenced→target rows become one
// session→referenced→target sentence, selected from either projected endpoint.

use rusqlite::Connection;
use yak_kernel::edge::edge_eid;
use yak_kernel::Store;

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

fn seed() -> (Fixture, String, String) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let uniq = SEQ.fetch_add(1, Ordering::Relaxed);
    let dir =
        std::env::temp_dir().join(format!("yak-projected-deps-{}-{uniq}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("g.db").to_string_lossy().into_owned();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "create table entity (
           id integer primary key, eid text not null unique, num integer unique
         );
         create table edge (
           entity integer primary key, \"from\" integer not null,
           \"to\" integer not null, ord integer
         );
         create index edge_from on edge(\"from\");
         create index edge_to on edge(\"to\");
         create table \"references\" (entity integer primary key);
         create table entry (
           entity integer primary key, session integer not null, seq integer not null
         );
         create index entry_session on entry(session);",
    )
    .unwrap();
    let session = "aaaaaaaa-0000-4000-8000-000000000001".to_string();
    let target = "aaaaaaaa-0000-4000-8000-000000000002".to_string();
    let first = "aaaaaaaa-0000-4000-8000-000000000003";
    let second = "aaaaaaaa-0000-4000-8000-000000000004";
    for (eid, num) in
        [(&session, 1), (&target, 2), (&first.to_string(), 3), (&second.to_string(), 4)]
    {
        conn.execute("insert into entity (eid, num) values (?1, ?2)", rusqlite::params![eid, num])
            .unwrap();
    }
    let id = |eid: &str| -> i64 {
        conn.query_row("select id from entity where eid = ?1", [eid], |r| r.get(0)).unwrap()
    };
    let sid = id(&session);
    let target_id = id(&target);
    for (seq, eid) in [(1, first), (2, second)] {
        let entry = id(eid);
        conn.execute(
            "insert into entry (entity, session, seq) values (?1, ?2, ?3)",
            rusqlite::params![entry, sid, seq],
        )
        .unwrap();
        // The sentence: an edge entity wearing its ends and the `references`
        // nature — `referenced` is its WIRE spelling (edge.rs).
        let said = edge_eid(eid, "references", &target);
        conn.execute("insert into entity (eid) values (?1)", [&said]).unwrap();
        let edge = conn.last_insert_rowid();
        conn.execute(
            "insert into edge (entity, \"from\", \"to\") values (?1, ?2, ?3)",
            rusqlite::params![edge, entry, target_id],
        )
        .unwrap();
        conn.execute("insert into \"references\" (entity) values (?1)", [edge]).unwrap();
    }
    drop(conn);
    (Fixture { path, dir }, session, target)
}

#[test]
fn entry_endpoints_project_to_their_session_and_dedupe() {
    let (fixture, session, target) = seed();
    let store = Store::open(&fixture.path).unwrap();
    let sentence = (session.clone(), "referenced".to_string(), target.clone());
    let triples = |eids: &[String]| {
        store
            .projected_deps(eids, "referenced", "entry", "session")
            .into_iter()
            .map(|d| (d.parent, d.type_, d.child))
            .collect::<Vec<_>>()
    };
    assert_eq!(triples(std::slice::from_ref(&session)).as_slice(), std::slice::from_ref(&sentence),);
    assert_eq!(triples(std::slice::from_ref(&target)).as_slice(), std::slice::from_ref(&sentence),);
}
