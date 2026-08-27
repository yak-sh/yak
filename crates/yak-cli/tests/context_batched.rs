// `yak context` (the boot digest, the fleet's hottest verb) loads every
// related entity in one bulk pass (store.rows_of), never a row-at-a-time N+1
// (M-17862, T-22778). The digest bulk-loads tasks already, then used to
// re-materialize sessions, decisions, fleet memories, claims and comments one
// eid at a time — each `store.row()` re-probing all ~125 comp tables. On the
// live graph that was 2013 eids × 125 tables ≈ 203K statements (~3s, 82% SQL).
//
// The dominant population is the actor's SESSIONS (line 263): the project
// digest loads every session whose actor = the project, only to render one
// `## previously` brief plus a short resume stack. Two promises, driven
// through the real binary against a temp graph — never the owner's file:
//   1. parity — the batched path still renders `## previously` from the
//      newest briefed session of the actor.
//   2. no N+1 — the SQL count the profile reports does not grow with the
//      number of sessions: the old per-eid path re-probed the graph ~125
//      statements per session.

use rusqlite::{params, Connection};
use std::path::Path;
use std::process::{Command, Output};

// The session table verbatim from the live schema (DDL only — no data): the
// digest's session comp query selects these columns, so a short fixture would
// error the query and load no sessions. Only the tables the digest reads are
// created; the store skips every absent comp table (has_table), so this
// handful is enough. Returns the db path.
fn fixture(dir: &Path, sessions: usize) -> String {
    std::fs::create_dir_all(dir).unwrap();
    let db = dir.join("tasks.db");
    let conn = Connection::open(&db).unwrap();
    conn.execute_batch(
        "create table entity (id integer primary key, eid text unique, \
           num integer, at text);
         create table project (entity integer primary key, color text);
         create table doc (entity integer primary key, title text not null, \
           body text not null default '');
         create table brief (entity integer primary key, text text not null);
         create table created (entity integer primary key, at text, \
           \"by\" integer, via integer);
         create table session (
           entity integer primary key, id text not null unique, cwd text,
           pid integer, pane text, turn text, notice_at text,
           notice_accepted_at text, notice_token text, transcript text,
           agent_type text, source text, operator integer, parent integer,
           origin text not null default 'external', provider text, model text,
           effort text, persona integer, requested_task integer, role integer,
           branch text, base_revision text, status text,
           provider_session_id text, serving_model text,
           latest_seq integer not null default 0, standing text,
           started_at text, stop_requested_at text, input_at text,
           finished_at text, exit_code integer, stop_reason text,
           final_text text, usage_json text, stderr text, actor integer);
         -- the project the digest is scoped to; every session's actor
         insert into entity (id, eid, num) \
           values (1, '00000000-0000-0000-0000-000000000001', 1);
         insert into project (entity) values (1);
         insert into doc (entity, title) values (1, 'Test Project');",
    )
    .unwrap();
    for i in 0..sessions {
        let id = 100 + i as i64;
        let eid = format!("aaaaaaaa-0000-0000-0000-{:012}", id);
        conn.execute(
            "insert into entity (id, eid, num) values (?1, ?2, ?1)",
            params![id, eid],
        )
        .unwrap();
        // session.actor = the project (id 1); a brief so `## previously` has
        // something to render; a created.at so it sorts newest-first
        conn.execute(
            "insert into session (entity, id, actor) values (?1, ?2, 1)",
            params![id, eid],
        )
        .unwrap();
        conn.execute(
            "insert into brief (entity, text) values (?1, ?2)",
            params![id, format!("brief from session {id}")],
        )
        .unwrap();
        conn.execute(
            "insert into created (entity, at) values (?1, ?2)",
            params![id, format!("2026-08-20T00:00:{:02}.000Z", i % 60)],
        )
        .unwrap();
    }
    db.to_string_lossy().into_owned()
}

fn run(db: &str, args: &[&str], profile: bool) -> Output {
    let mut c = Command::new(env!("CARGO_BIN_EXE_yak"));
    c.env("DB_PATH", db);
    c.env_remove("YAK_PROFILE").env_remove("TASKS_PROFILE");
    if profile {
        c.env("YAK_PROFILE", "1");
    }
    c.args(args).output().unwrap()
}

// The `n` column of the SQL table's `total` row — how many statements the
// verb executed. The phase table also ends in a `total` line, but with two
// columns; the SQL one has four, so pick the total with four fields.
fn sql_count(stderr: &[u8]) -> usize {
    let text = String::from_utf8_lossy(stderr);
    for l in text.lines() {
        let f: Vec<&str> = l.split_whitespace().collect();
        if f.first() == Some(&"total") && f.len() == 4 {
            return f[1].parse().unwrap();
        }
    }
    panic!("no SQL total row in profile:\n{text}");
}

#[test]
fn context_renders_previously_from_the_newest_brief() {
    let dir = std::env::temp_dir()
        .join(format!("yak-ctx-parity-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = fixture(&dir, 3);
    // resolve the project by num (1) → the project branch of the digest
    let out = run(&db, &["context", "1"], false);
    std::fs::remove_dir_all(&dir).ok();

    assert_eq!(out.status.code(), Some(0));
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("## previously"),
        "previously block missing:\n{text}"
    );
    // the newest brief wins — session 102 has the latest created.at
    assert!(
        text.contains("brief from session 102"),
        "newest brief not rendered:\n{text}"
    );
}

#[test]
fn context_reads_its_sessions_without_an_n_plus_1() {
    let dir = std::env::temp_dir()
        .join(format!("yak-ctx-n1-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (few, many) = (4usize, 40usize);
    let small = run(&fixture(&dir.join("a"), few), &["context", "1"], true);
    let large = run(&fixture(&dir.join("b"), many), &["context", "1"], true);
    std::fs::remove_dir_all(&dir).ok();

    assert_eq!(small.status.code(), Some(0));
    assert_eq!(large.status.code(), Some(0));

    let (n_small, n_large) = (sql_count(&small.stderr), sql_count(&large.stderr));
    // The batched read issues a fixed set of statements no matter how many
    // sessions there are, so the count barely moves. The old per-eid path
    // re-probed the graph ~125 statements per session — here 36 more sessions
    // would be thousands more statements.
    assert!(
        n_large.saturating_sub(n_small) < (many - few),
        "query count scaled with sessions ({n_small} → {n_large}): an N+1"
    );
}
