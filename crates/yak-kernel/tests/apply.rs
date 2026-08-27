// apply() semantics against an in-memory subset of the real schema — the
// same DDL shapes db.ts declares for the tables these tests touch. The full
// schema lives with the TS migrator; the parity harness (scripts/parity)
// drives both writers over a REAL migrated file. Here: the rules, sub-ms.

use yak_kernel::change::Change;
use yak_kernel::feed::{cursor_of, journal_since, row_changes, Feed};
use yak_kernel::write::{apply, default_gates, native_safe, ApplyError, ApplyOpts, WriteStore};
use rusqlite::Connection;
use serde_json::{json, Map, Value};

const SCHEMA: &str = "
  create table entity (
    id  integer primary key,
    eid text not null unique,
    num integer unique
  );
  create table tombstone (
    eid text primary key,
    num integer,
    deleted_at text not null
  );
  create table dependency (
    parent integer not null references entity(id),
    type   text not null,
    child  integer not null references entity(id),
    ord    integer,
    primary key (parent, type, child)
  );
  create table journal (
    ts text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    actor text, via text, batch text not null, trace text
  );
  create table journal_touch (jrow integer not null, eid text not null);
  create table doc (
    entity integer primary key references entity(id),
    title text not null,
    body  text not null default ''
  );
  create table task (
    entity integer primary key references entity(id),
    status text not null default 'open',
    priority real not null default 0,
    project integer,
    assignee integer,
    domain text
  );
  create table project (
    entity integer primary key references entity(id),
    color text
  );
  create table session (
    entity integer primary key references entity(id),
    id text unique,
    cwd text,
    actor integer
  );
  create table claim (
    entity integer primary key references entity(id),
    session integer not null,
    claimed_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table conflict (
    entity integer primary key references entity(id),
    target integer not null,
    loser text not null,
    holder text not null,
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table comment (
    entity integer primary key references entity(id),
    target integer not null references entity(id)
  );
  create table alias (
    entity integer primary key references entity(id),
    slug text not null unique,
    slugs text
  );
  create table created (
    entity integer primary key references entity(id),
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    \"by\" integer, via integer
  );
  create table updated (
    entity integer primary key references entity(id),
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    \"by\" integer, via integer
  );
";

fn store() -> WriteStore {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA).unwrap();
    WriteStore::from_conn(conn)
}

fn ch(eid: &str, name: &str, comp: Value) -> Change {
    let comp = match comp {
        Value::Null => None,
        Value::Object(m) => Some(m),
        _ => panic!("comp must be an object or null"),
    };
    Change::new(eid, name, comp)
}

fn run(s: &WriteStore, changes: Vec<Change>) -> Vec<Change> {
    apply(s, changes, &ApplyOpts::default(), &default_gates()).unwrap()
}

// Session rows are seeded by SQL: the wire door for sessions is the TS
// sessions plugin (dualSpawn etc.), so the kernel refuses them (UNPORTED).
fn seed_session(s: &WriteStore, eid: &str, label: &str) {
    s.conn
        .execute("insert into entity (eid) values (?1)", [eid])
        .unwrap();
    s.conn
        .execute(
            "insert into session (entity, id) values \
             ((select id from entity where eid = ?1), ?2)",
            [eid, label],
        )
        .unwrap();
}

fn one<T: rusqlite::types::FromSql>(s: &WriteStore, sql: &str) -> T {
    s.conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

const A: &str = "aaaaaaaa-0000-4000-8000-000000000001";
const B: &str = "aaaaaaaa-0000-4000-8000-000000000002";
const C: &str = "aaaaaaaa-0000-4000-8000-000000000003";
const D: &str = "aaaaaaaa-0000-4000-8000-000000000004";

#[test]
fn create_stamps_numbers_and_journals() {
    let s = store();
    let out = run(
        &s,
        vec![
            ch(A, "doc", json!({"title": "Hello"})),
            ch(A, "task", json!({"status": "open"})),
        ],
    );
    // num minted, created stamped, births + provenance ride the return
    let num: i64 = one(&s, "select num from entity where eid like 'aaaa%'");
    assert_eq!(num, 1);
    assert!(out.iter().any(|c| c.name == "entity" && c.comp.is_some()));
    assert!(out.iter().any(|c| c.name == "created"));
    // journal: one row; created/updated echoes LEFT OUT; created comps are
    // completed to the persisted shape (body default rides the batch)
    let batch: String = one(&s, "select batch from journal");
    let v: Value = serde_json::from_str(&batch).unwrap();
    let doc = v
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "doc")
        .unwrap();
    assert_eq!(doc["comp"]["body"], json!(""));
    assert!(!batch.contains("\"created\""));
    // trace is null unless the caller fed the journal
    let trace: Option<String> = one(&s, "select trace from journal");
    assert!(trace.is_none());
    // journal_touch: one row per touched eid
    let touched: i64 = one(&s, "select count(*) from journal_touch");
    assert_eq!(touched, 1);
}

#[test]
fn native_safe_routes_plain_graph_and_proxies_the_rest() {
    // The bridge's divergence predicate (D-22804 rung 4): a batch commits
    // natively only if EVERY change names a transform-free NATIVE_COMPS comp.
    let ok = |cs: Vec<Change>| native_safe(&cs);
    // plain-graph creates/updates/edges → native.
    assert!(ok(vec![ch(A, "doc", json!({"title": "x"})), ch(A, "task", json!({"status": "open"}))]));
    assert!(ok(vec![ch(A, "board", json!({"query": ".task!"}))]));
    assert!(ok(vec![ch(A, "project", json!({}))]));
    assert!(ok(vec![ch(A, "comment", json!({"target": B}))]));
    assert!(ok(vec![ch(A, "dependency", json!({"type": "requires", "child": B}))]));
    // a transform-bearing comp (setting/session/deliver/wake/entry) → proxy.
    assert!(!ok(vec![ch(A, "setting", json!({"key": "k", "value": "v"}))]));
    assert!(!ok(vec![ch(A, "session", json!({"id": "S-1"}))]));
    // a claim (its release owes the unported resume stack) → proxy.
    assert!(!ok(vec![ch(A, "claim", json!({"session": B}))]));
    // an entity DELETE (cascade can reach claim→resume) → proxy.
    assert!(!ok(vec![ch(A, "entity", Value::Null)]));
    // a MIXED batch proxies whole — apply() is atomic, no splitting.
    assert!(!ok(vec![ch(A, "doc", json!({"title": "x"})), ch(A, "claim", json!({"session": B}))]));
    // an empty batch proxies (Deno owns the trivial answer).
    assert!(!ok(vec![]));
}

#[test]
fn fed_trace_serializes_created_and_removed() {
    let s = store();
    let opts = ApplyOpts { writer: None, fed: true };
    apply(&s, vec![ch(A, "doc", json!({"title": "x"}))], &opts, &default_gates())
        .unwrap();
    apply(&s, vec![ch(A, "doc", Value::Null)], &opts, &default_gates()).unwrap();
    let traces: Vec<String> = {
        let mut st = s.conn.prepare("select trace from journal order by rowid").unwrap();
        let rows = st.query_map([], |r| r.get(0)).unwrap();
        rows.flatten().collect()
    };
    assert!(traces[0].contains(&format!("doc {A}")));
    let t: Value = serde_json::from_str(&traces[1]).unwrap();
    assert_eq!(t["removed"][0][0], json!(A));
    assert_eq!(t["removed"][0][1][0], json!("doc"));
}

#[test]
fn was_guard_passes_and_refuses() {
    let s = store();
    run(&s, vec![ch(A, "doc", json!({"title": "v1"}))]);
    // guarded patch with the read value's hash passes
    let mut c = ch(A, "doc", json!({"title": "v2"}));
    let mut was = Map::new();
    was.insert("title".into(), Value::from(yak_kernel::write::sha(&json!("v1"))));
    c.was = Some(was.clone());
    run(&s, vec![c]);
    let title: String = one(&s, "select title from doc");
    assert_eq!(title, "v2");
    // the same stale hash now refuses the whole batch
    let mut c = ch(A, "doc", json!({"title": "v3"}));
    c.was = Some(was);
    let err = apply(&s, vec![c], &ApplyOpts::default(), &default_gates());
    assert!(matches!(err, Err(ApplyError::Stale { .. })));
    let title: String = one(&s, "select title from doc");
    assert_eq!(title, "v2");
}

#[test]
fn was_on_unknown_column_fails_closed() {
    let s = store();
    run(&s, vec![ch(A, "doc", json!({"title": "x"}))]);
    let mut c = ch(A, "doc", json!({"title": "y"}));
    let mut was = Map::new();
    was.insert("titel".into(), Value::from("deadbeef"));
    c.was = Some(was);
    let err = apply(&s, vec![c], &ApplyOpts::default(), &default_gates());
    assert!(err.unwrap_err().to_string().contains("unknown column: doc.titel"));
}

#[test]
fn unknown_column_refuses_server_owned_drops() {
    let s = store();
    let err = apply(
        &s,
        vec![ch(A, "task", json!({"statuss": "done"}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("unknown column"));
    // a server-owned comp is dropped in silence: nothing lands, no journal
    let out = run(&s, vec![ch(A, "resume", json!({"rank": 1}))]);
    assert!(out.is_empty());
    let n: i64 = one(&s, "select count(*) from journal");
    assert_eq!(n, 0);
}

#[test]
fn enum_and_unported_refuse() {
    let s = store();
    let err = apply(
        &s,
        vec![ch(A, "task", json!({"status": "donee"}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("expects one of"));
    let err = apply(
        &s,
        vec![ch(A, "entry", json!({"session": B}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("not ported"));
}

#[test]
fn edges_link_and_unlink() {
    let s = store();
    run(&s, vec![ch(A, "task", json!({})), ch(B, "task", json!({}))]);
    run(&s, vec![ch(A, "dependency", json!({"type": "requires", "child": B}))]);
    let n: i64 = one(&s, "select count(*) from dependency where type = 'requires'");
    assert_eq!(n, 1);
    run(
        &s,
        vec![ch(A, "dependency", json!({"type": "requires", "child": B, "gone": true}))],
    );
    let n: i64 = one(&s, "select count(*) from dependency where type = 'requires'");
    assert_eq!(n, 0);
    // an unknown edge word refuses in normalize, like TS parseProp
    let err = apply(
        &s,
        vec![ch(A, "dependency", json!({"type": "zzz", "child": B}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("expects one of"));
}

#[test]
fn claim_lease_bounces_and_audits() {
    let s = store();
    run(&s, vec![ch(A, "task", json!({}))]);
    seed_session(&s, B, "sess-b");
    seed_session(&s, C, "sess-c");
    run(&s, vec![ch(A, "claim", json!({"session": B}))]);
    // claim implies wip; the worked edge lands
    let status: String = one(&s, "select status from task");
    assert_eq!(status, "wip");
    let n: i64 = one(&s, "select count(*) from dependency where type = 'worked'");
    assert_eq!(n, 1);
    // a second session's claim bounces the batch and mints a conflict audit
    let err = apply(
        &s,
        vec![ch(A, "claim", json!({"session": C}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("already claimed by sess-b"));
    let holder: String = one(&s, "select holder from conflict");
    assert_eq!(holder, "sess-b");
    let loser: String = one(&s, "select loser from conflict");
    assert_eq!(loser, "sess-c");
    // the same session re-claiming is a no-op refresh
    run(&s, vec![ch(A, "claim", json!({"session": B}))]);
}

#[test]
fn delete_cascades_by_death_word() {
    let s = store();
    run(
        &s,
        vec![
            ch(D, "project", json!({})),
            ch(A, "task", json!({"project": D})),
            ch(B, "doc", json!({"title": "note"})),
            ch(B, "comment", json!({"target": A})),
        ],
    );
    seed_session(&s, C, "sess");
    run(&s, vec![ch(A, "claim", json!({"session": C}))]);
    // deleting the task: the comment ABOUT it dies (cascade), the claim ON it
    // releases, and the return carries the casualties + the release
    let out = run(&s, vec![ch(A, "entity", Value::Null)]);
    assert!(out.iter().any(|c| c.eid == B && c.name == "entity" && c.comp.is_none()));
    let dead: i64 = one(&s, "select count(*) from tombstone");
    assert_eq!(dead, 2);
    let comments: i64 = one(&s, "select count(*) from comment");
    assert_eq!(comments, 0);
    let claims: i64 = one(&s, "select count(*) from claim");
    assert_eq!(claims, 0);
    // deleting the project detaches the surviving pointer column
    const E: &str = "aaaaaaaa-0000-4000-8000-000000000005";
    run(&s, vec![ch(E, "task", json!({"project": D}))]);
    let out = run(&s, vec![ch(D, "entity", Value::Null)]);
    assert!(out.iter().any(|c| {
        c.eid == E
            && c.name == "task"
            && c.comp.as_ref().map(|m| m.get("project") == Some(&Value::Null)).unwrap_or(false)
    }));
    let orphaned: Option<i64> = s
        .conn
        .query_row("select project from task where entity = (select id from entity where eid = ?1)", [E], |r| r.get(0))
        .unwrap();
    assert!(orphaned.is_none());
    // a tombstoned eid voids every later touch
    let out = run(&s, vec![ch(A, "doc", json!({"title": "ghost"}))]);
    assert!(out.iter().all(|c| c.name != "created"));
}

#[test]
fn alias_gate_refuses_a_taken_slug() {
    let s = store();
    run(
        &s,
        vec![ch(A, "doc", json!({"title": "one"})), ch(A, "alias", json!({"slug": "one"}))],
    );
    let err = apply(
        &s,
        vec![ch(B, "doc", json!({"title": "two"})), ch(B, "alias", json!({"slug": "one"}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("already names"));
}

#[test]
fn ghost_reference_refuses() {
    let s = store();
    let err = apply(
        &s,
        vec![ch(A, "comment", json!({"target": B}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("no such entity"));
}

#[test]
fn feed_hands_each_row_once_and_replays_provenance() {
    let s = store();
    let mut feed = Feed::from_tip(&s.conn);
    run(&s, vec![ch(A, "doc", json!({"title": "x"}))]);
    run(&s, vec![ch(A, "doc", json!({"title": "y"}))]);
    let mut seen: Vec<i64> = vec![];
    feed.settle(&s.conn, &mut |r| seen.push(r.rowid));
    assert_eq!(seen.len(), 2);
    feed.settle(&s.conn, &mut |_| panic!("row handed twice"));
    // rowChanges: a birth replays as created, a later touch as updated
    let rows = journal_since(&s.conn, 0);
    let first = row_changes(&rows[0]);
    assert!(first.iter().any(|c| c.name == "created" && c.eid == A));
    let second = row_changes(&rows[1]);
    assert!(second.iter().any(|c| c.name == "updated" && c.eid == A));
    assert_eq!(cursor_of(&s.conn), 2);
}
