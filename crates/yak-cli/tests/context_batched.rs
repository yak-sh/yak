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
        conn.execute("insert into entity (id, eid, num) values (?1, ?2, ?1)", params![id, eid])
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

// Real comp-table names the digest NEVER renders — a slice of the ~125 the
// graph carries. A projected read (rows_of_cols/rows_of_kind_cols/row_cols,
// T-22823) touches only the comps a section names, so creating these empty
// tables must not add a single statement; the old full-entity fill queried
// every existing comp table per section, so it would add one apiece. If a
// future digest section starts rendering one of these, this canary fires —
// move the name out of the list and into the section's sel list.
const UNRENDERED_COMPS: &[&str] = &[
    "notified",
    "opened",
    "archived",
    "delivered",
    "error",
    "exception",
    "blocked",
    "content",
    "message",
    "prompt",
    "bash",
    "tool",
    "output",
    "imported",
    "opaque",
    "call",
    "stderr",
    "chat",
    "conflict",
    "redaction",
];

fn add_empty_comp_tables(db: &str) {
    let conn = Connection::open(db).unwrap();
    for c in UNRENDERED_COMPS {
        conn.execute_batch(&format!("create table \"{c}\" (entity integer primary key);")).unwrap();
    }
}

// Sessions of the actor carrying NEITHER a brief NOR a final_text — the rows
// the bounded session load must never materialize (T-22787). They are stamped
// NEWER than every briefed session, so a correct `previously` still skips them
// (nothing to quote) and the read never pays to load them.
fn add_unbriefed_sessions(db: &str, n: usize) {
    let conn = Connection::open(db).unwrap();
    for i in 0..n {
        let id = 5000 + i as i64;
        let eid = format!("bbbbbbbb-0000-0000-0000-{:012}", id);
        conn.execute("insert into entity (id, eid, num) values (?1, ?2, ?1)", params![id, eid])
            .unwrap();
        conn.execute(
            "insert into session (entity, id, actor) values (?1, ?2, 1)",
            params![id, eid],
        )
        .unwrap();
        conn.execute(
            "insert into created (entity, at) values (?1, ?2)",
            params![id, "2026-09-01T00:00:00.000Z"],
        )
        .unwrap();
    }
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

// The `rows` column of the SQL `total` row — how many rows every statement
// materialized in sum. Statement COUNT alone cannot see the session bound: the
// full and bounded loads issue the same bulk statements, differing only in how
// many rows those statements build. This is the number that must not scale
// with the un-briefed population.
fn sql_rows(stderr: &[u8]) -> usize {
    let text = String::from_utf8_lossy(stderr);
    for l in text.lines() {
        let f: Vec<&str> = l.split_whitespace().collect();
        if f.first() == Some(&"total") && f.len() == 4 {
            return f[3].parse().unwrap();
        }
    }
    panic!("no SQL total row in profile:\n{text}");
}

#[test]
fn context_renders_previously_from_the_newest_brief() {
    let dir = std::env::temp_dir().join(format!("yak-ctx-parity-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = fixture(&dir, 3);
    // resolve the project by num (1) → the project branch of the digest
    let out = run(&db, &["context", "1"], false);
    std::fs::remove_dir_all(&dir).ok();

    assert_eq!(out.status.code(), Some(0));
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("## previously"), "previously block missing:\n{text}");
    // the newest brief wins — session 102 has the latest created.at
    assert!(text.contains("brief from session 102"), "newest brief not rendered:\n{text}");
}

#[test]
fn context_reads_its_sessions_without_an_n_plus_1() {
    let dir = std::env::temp_dir().join(format!("yak-ctx-n1-{}", std::process::id()));
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

#[test]
fn context_read_does_not_scale_with_the_comp_table_surface() {
    let dir = std::env::temp_dir().join(format!("yak-ctx-surface-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    // Same graph, twice: once bare, once with a slab of extra comp tables the
    // digest never renders. A projected read ignores them; the old full fill
    // probed every existing comp table per section. Read from a SESSION (num
    // 100, the first fixture session) not the project, so this exercises the
    // digest's own reads and not the preview-only inbox count (which still
    // materializes fully — a separate residual outside this fix).
    let lean = fixture(&dir.join("lean"), 8);
    let wide = fixture(&dir.join("wide"), 8);
    add_empty_comp_tables(&wide);

    let a = run(&lean, &["context", "100"], true);
    let b = run(&wide, &["context", "100"], true);
    std::fs::remove_dir_all(&dir).ok();

    assert_eq!(a.status.code(), Some(0));
    assert_eq!(b.status.code(), Some(0));
    let (n_lean, n_wide) = (sql_count(&a.stderr), sql_count(&b.stderr));
    // Every DIGEST section reads projected, so it adds nothing per extra table.
    // What little growth remains is two fixed full row() probes OUTSIDE this
    // fix's lane — the CLI's arg classification (main.rs) and scope_for's
    // actor-is-a-project check (reader.rs) — each O(1), not per-section. The
    // old full-entity digest re-probed every comp table in ~9 sections, so it
    // grew by ~9× the surface; the guard is that growth stays a small constant.
    let growth = n_wide.saturating_sub(n_lean);
    assert!(
        growth <= 2 * UNRENDERED_COMPS.len(),
        "{} extra comp tables grew the statement count by {growth} ({n_lean} → \
         {n_wide}): a digest section is materializing the whole comp surface \
         again, not reading projected",
        UNRENDERED_COMPS.len()
    );
}

#[test]
fn context_previously_skips_newer_unbriefed_sessions() {
    // The bounded session load (T-22787) reads only the actor's BRIEFED
    // sessions for `## previously`. Adding newer un-briefed sessions must not
    // change the pick: the newest BRIEFED session still wins, because an
    // un-briefed one carries nothing to quote. This is the correctness half of
    // the bound — drop the briefed session and previously would go blank; keep
    // the un-briefed ones and it would quote the wrong session.
    let dir = std::env::temp_dir().join(format!("yak-ctx-skip-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = fixture(&dir, 3); // sessions 100-102 briefed; 102 is newest
    add_unbriefed_sessions(&db, 5); // sessions 5000+, newer, un-briefed
    let out = run(&db, &["context", "1"], false);
    std::fs::remove_dir_all(&dir).ok();

    assert_eq!(out.status.code(), Some(0));
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("## previously"), "previously block missing:\n{text}");
    assert!(
        text.contains("brief from session 102"),
        "newest BRIEFED session not rendered — a newer un-briefed session won:\n{text}"
    );
}

#[test]
fn context_bounds_the_session_load_to_briefed_and_claimholders() {
    // The perf half of the bound: rows materialized must not scale with the
    // actor's un-briefed session history. Same graph twice — one bare, one with
    // 40 extra un-briefed sessions — read from the project so both render the
    // same `## previously`. The full load would materialize all 40 across the
    // session comp tables; the bounded load reads only the briefed set (plus
    // claim holders, none here), so total rows grow by a small constant.
    let dir = std::env::temp_dir().join(format!("yak-ctx-bound-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let lean = fixture(&dir.join("lean"), 3);
    let wide = fixture(&dir.join("wide"), 3);
    add_unbriefed_sessions(&wide, 40);

    let a = run(&lean, &["context", "1"], true);
    let b = run(&wide, &["context", "1"], true);
    std::fs::remove_dir_all(&dir).ok();

    assert_eq!(a.status.code(), Some(0));
    assert_eq!(b.status.code(), Some(0));
    let (r_lean, r_wide) = (sql_rows(&a.stderr), sql_rows(&b.stderr));
    // 40 un-briefed sessions across the session/created/entity reads are ~120
    // extra rows under the full load (measured: +120). The bounded load skips
    // them entirely (measured: +0), so the growth stays a small constant well
    // under one per-session row — the threshold sits between the two.
    let growth = r_wide.saturating_sub(r_lean);
    assert!(
        growth <= 40,
        "bounded session load materialized the un-briefed sessions: \
         rows {r_lean} → {r_wide} (+{growth})"
    );
}
