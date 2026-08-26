// `inbox --sent` reads its mail set in one bulk pass (rows_of_kind), never a
// row-at-a-time N+1 (M-17862, T-22633). Two promises, driven through the real
// binary against a temp graph — never the owner's file:
//   1. parity — the batched path returns exactly the outbound letters (a mail
//      comp, no message_id, a deliver.to that resolves) and excludes a received
//      one (a message_id).
//   2. no N+1 — the SQL count the profile reports does not grow with the number
//      of mail rows: the old `eids_of_kind().filter_map(row)` re-probed the
//      graph ~3 statements per row.

use rusqlite::{params, Connection};
use std::path::Path;
use std::process::{Command, Output};

// A graph with `sent` outbound letters plus one received letter that
// `--sent` must screen out. Only the tables the verb reads are created; the
// store skips every comp table that is absent (has_table), so a minimal
// fixture is enough. Returns the db path.
fn fixture(dir: &Path, sent: usize) -> String {
    std::fs::create_dir_all(dir).unwrap();
    let db = dir.join("tasks.db");
    let conn = Connection::open(&db).unwrap();
    conn.execute_batch(
        "create table entity (id integer primary key, eid text unique, \
           num integer, at text);
         create table mail (entity integer primary key, target integer, \
           reply_to integer, \"from\" text, to_addr text, message_id text, \
           received_at text, verified integer, sent_id text, \
           in_reply_to text, headers text);
         create table deliver (entity integer primary key, \"to\" integer);
         -- the recipient every deliver.to resolves to
         insert into entity (id, eid, num) \
           values (1, '00000000-0000-0000-0000-000000000001', 1);",
    )
    .unwrap();
    for i in 0..sent {
        let id = 100 + i as i64;
        let eid = format!("aaaaaaaa-0000-0000-0000-{:012}", id);
        conn.execute(
            "insert into entity (id, eid, num) values (?1, ?2, ?1)",
            params![id, eid],
        )
        .unwrap();
        // a mail comp with no message_id, and a deliver.to that resolves
        conn.execute("insert into mail (entity) values (?1)", params![id])
            .unwrap();
        conn.execute(
            "insert into deliver (entity, \"to\") values (?1, 1)",
            params![id],
        )
        .unwrap();
    }
    // a received letter — it wears a message_id, so `--sent` excludes it
    conn.execute(
        "insert into entity (id, eid, num) \
         values (9, 'bbbbbbbb-0000-0000-0000-000000000009', 9)",
        [],
    )
    .unwrap();
    conn.execute(
        "insert into mail (entity, message_id) values (9, '<in@example>')",
        [],
    )
    .unwrap();
    conn.execute("insert into deliver (entity, \"to\") values (9, 1)", [])
        .unwrap();
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
fn sent_returns_the_outbound_letters_only() {
    let dir = std::env::temp_dir()
        .join(format!("yak-sent-parity-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = fixture(&dir, 3);
    let out = run(&db, &["inbox", "--sent"], false);
    std::fs::remove_dir_all(&dir).ok();

    assert_eq!(out.status.code(), Some(0));
    let lines: Vec<&str> = std::str::from_utf8(&out.stdout)
        .unwrap()
        .lines()
        .collect();
    // one line per outbound letter, and the received one is screened out
    assert_eq!(lines.len(), 3, "stdout: {lines:?}");
    for num in [100, 101, 102] {
        assert!(
            lines.iter().any(|l| l.contains(&format!("E-{num}"))),
            "missing E-{num} in {lines:?}"
        );
    }
    assert!(
        !lines.iter().any(|l| l.contains("E-9")),
        "received letter E-9 should be excluded: {lines:?}"
    );
}

#[test]
fn sent_reads_its_mail_set_without_an_n_plus_1() {
    let dir = std::env::temp_dir()
        .join(format!("yak-sent-n1-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (few, many) = (2usize, 12usize);
    let small = run(&fixture(&dir.join("a"), few), &["inbox", "--sent"], true);
    let large = run(&fixture(&dir.join("b"), many), &["inbox", "--sent"], true);
    std::fs::remove_dir_all(&dir).ok();

    // both listed their letters (the sanity that the profile ran the verb)
    assert_eq!(small.status.code(), Some(0));
    assert_eq!(large.status.code(), Some(0));

    let (n_small, n_large) = (sql_count(&small.stderr), sql_count(&large.stderr));
    // The batched read issues a fixed set of statements no matter how many
    // mail rows there are, so the count barely moves. The old per-row path
    // re-probed the graph ~3 statements per row — here that would be ~30 more.
    assert!(
        n_large.saturating_sub(n_small) < (many - few),
        "query count scaled with rows ({n_small} → {n_large}): an N+1"
    );
}
