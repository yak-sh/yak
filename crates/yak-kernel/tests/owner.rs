// The owner reads (owner.rs) against an in-memory subset of the real schema:
// who the owner is, the said stream (typed turns + authored entities), what
// recently had their attention, and what waits on a decision.

use rusqlite::Connection;
use yak_kernel::owner::{attention, owner, recent, said};
use yak_kernel::Store;

const SCHEMA: &str = "
  create table entity (id integer primary key, eid text not null unique, num integer unique);
  create table tombstone (eid text primary key, num integer, deleted_at text not null);
  create table person (entity integer primary key references entity(id));
  create table email (entity integer primary key references entity(id), address text);
  create table blob (entity integer primary key references entity(id), bytes integer not null);
  create table blob_text (entity integer primary key references blob(entity), value text not null);
  create table doc (entity integer primary key references entity(id), title text not null, body integer not null references blob(entity));
  create table prompt (entity integer primary key references entity(id));
  create table entry (entity integer primary key references entity(id), session integer not null, seq integer not null);
  create table message (entity integer primary key references entity(id), role text not null);
  create table content (entity integer primary key references entity(id), body text not null default '');
  create table session (entity integer primary key references entity(id), pane text, origin text not null default 'external', agent_type text);
  create table created (entity integer primary key references entity(id), at text not null, \"by\" integer, via integer);
  create table opened (entity integer primary key references entity(id), at text not null, \"by\" integer, via integer);
  create table proposed (entity integer primary key references entity(id), at text not null, \"by\" integer, via integer);
  create table decided (entity integer primary key references entity(id), at text not null, \"by\" integer, via integer, verdict text);
  create table quarantined (entity integer primary key references entity(id), at text not null, \"by\" integer, via integer);
";

struct Fixture {
    path: String,
}

impl Fixture {
    fn new(name: &str) -> Fixture {
        let path = std::env::temp_dir()
            .join(format!("yak-owner-{name}-{}.db", std::process::id()))
            .to_string_lossy()
            .into_owned();
        let _ = std::fs::remove_file(&path);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        Fixture { path }.seed(&conn)
    }

    // Entities 1..: 1 jeff (person), 2 a session with a pane, 3 a managed
    // session, 4 a typed turn in 2, 5 a hook-injected user turn in 2 (no
    // prompt tag), 6 a user turn in the managed session 3 (prompt-tagged but
    // not a human's), 7 a comment jeff authored, 8 a memory an agent proposed,
    // 9 a design jeff decided, 10 a task jeff opened.
    fn seed(self, c: &Connection) -> Fixture {
        for (id, eid) in [
            (1, "jeff"),
            (2, "sess-pane"),
            (3, "sess-managed"),
            (4, "turn-typed"),
            (5, "turn-hook"),
            (6, "turn-managed"),
            (7, "comment-jeff"),
            (8, "memory-agent"),
            (9, "design-decided"),
            (10, "task-opened"),
        ] {
            c.execute("insert into entity (id, eid, num) values (?1, ?2, ?1)", (id, eid)).unwrap();
        }
        c.execute_batch(
            "insert into person values (1);
             insert into email values (1, 'jeff@yak.sh');
             insert into session values (2, '%1', 'external', null);
             insert into session values (3, null, 'managed', null);
             insert into entry values (4, 2, 1); insert into message values (4, 'user');
             insert into content values (4, 'fix the thing\nsecond line'); insert into prompt values (4);
             insert into created values (4, '2026-09-01T10:00:00Z', null, null);
             insert into entry values (5, 2, 2); insert into message values (5, 'user');
             insert into content values (5, 'Stop hook feedback:');
             insert into created values (5, '2026-09-01T10:01:00Z', null, null);
             insert into entry values (6, 3, 1); insert into message values (6, 'user');
             insert into content values (6, 'the brief'); insert into prompt values (6);
             insert into created values (6, '2026-09-01T10:02:00Z', null, null);
             insert into blob values (7, 5); insert into blob_text values (7, 'looks good');
             insert into doc values (7, '', 7);
             insert into created values (7, '2026-09-01T11:00:00Z', 1, null);
             insert into blob values (8, 4); insert into blob_text values (8, 'rule');
             insert into doc values (8, 'a memory', 8);
             insert into created values (8, '2026-09-01T09:00:00Z', null, null);
             insert into proposed values (8, '2026-09-01T09:00:00Z', null, null);
             insert into proposed values (9, '2026-08-30T09:00:00Z', null, null);
             insert into decided values (9, '2026-08-31T09:00:00Z', 1, null, 'approved');
             insert into opened values (10, '2026-09-01T12:00:00Z', 1, null);",
        )
        .unwrap();
        self
    }

    fn store(&self) -> Store {
        Store::open(&self.path).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[test]
fn owner_resolves_by_address_id_or_first_person() {
    let f = Fixture::new("owner");
    let s = f.store();
    assert_eq!(owner(&s, Some("JEFF@yak.sh")).as_deref(), Some("jeff"));
    assert_eq!(owner(&s, Some("U-1")).as_deref(), Some("jeff"));
    assert_eq!(owner(&s, None).as_deref(), Some("jeff"));
}

#[test]
fn said_is_typed_turns_and_authored_rows_newest_first() {
    let f = Fixture::new("said");
    let s = f.store();
    let got = said(&s, "jeff", 10);
    let eids: Vec<&str> = got.iter().map(|x| x.eid.as_str()).collect();
    // the comment (11:00) before the typed turn (10:00); the hook-injected
    // turn, the managed run's prompt, and the agent's memory never appear
    assert_eq!(eids, vec!["comment-jeff", "turn-typed"]);
    assert_eq!(got[1].via, "turn");
    assert_eq!(got[1].about, "sess-pane");
    assert_eq!(got[1].line, "fix the thing");
    assert_eq!(got[1].body, "fix the thing\nsecond line");
    assert_eq!(got[0].via, "created");
    assert_eq!(got[0].line, "looks good");
    assert_eq!(said(&s, "jeff", 1).len(), 1);
}

#[test]
fn recent_is_what_the_owner_opened_or_created() {
    let f = Fixture::new("recent");
    let s = f.store();
    let got = recent(&s, "jeff", 10);
    let acts: Vec<(&str, &str)> = got.iter().map(|t| (t.eid.as_str(), t.act.as_str())).collect();
    assert_eq!(acts, vec![("task-opened", "opened"), ("comment-jeff", "created")]);
}

#[test]
fn attention_is_proposed_without_a_decision() {
    let f = Fixture::new("attention");
    let s = f.store();
    let got = attention(&s);
    assert_eq!(got.iter().map(|(e, _)| e.as_str()).collect::<Vec<_>>(), vec!["memory-agent"]);
}
