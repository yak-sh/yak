// The profile's one hard promise, driven through the real binary: arming it
// must not move a single byte of stdout. The fixture is a one-table graph in
// a temp dir — never the owner's file, which a probe must never read for a
// verdict it is going to assert on.

use std::process::{Command, Output};

fn fixture(dir: &std::path::Path) -> String {
    let db = dir.join("tasks.db");
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(
        "create table entity (id integer primary key, eid text unique, \
           num integer, at text);
         insert into entity (id, eid, num) \
           values (1, '11111111-2222-3333-4444-555555555555', 7);",
    )
    .unwrap();
    db.to_string_lossy().into_owned()
}

fn run(db: &str, args: &[&str], profile_env: Option<&str>) -> Output {
    let mut c = Command::new(env!("CARGO_BIN_EXE_yak"));
    c.env("DB_PATH", db).args(args);
    c.env_remove("YAK_PROFILE").env_remove("TASKS_PROFILE");
    if let Some(k) = profile_env {
        c.env(k, "1");
    }
    c.output().unwrap()
}

#[test]
fn profiling_leaves_stdout_byte_identical() {
    let dir = std::env::temp_dir().join(format!("yak-prof-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = fixture(&dir);

    let plain = run(&db, &["show", "7"], None);
    let flagged = run(&db, &["--profile", "show", "7"], None);
    let yak = run(&db, &["show", "7"], Some("YAK_PROFILE"));
    // the tasks-era spelling still arms it
    let alias = run(&db, &["show", "7"], Some("TASKS_PROFILE"));
    std::fs::remove_dir_all(&dir).ok();

    assert!(!plain.stdout.is_empty(), "the fixture should render something");
    assert_eq!(plain.status.code(), flagged.status.code());
    // the whole point: the flag is invisible to stdout, and to verb parsing
    assert_eq!(plain.stdout, flagged.stdout);
    assert_eq!(plain.stdout, yak.stdout);
    assert_eq!(plain.stdout, alias.stdout);

    // off is silent on stderr too
    assert_eq!(String::from_utf8_lossy(&plain.stderr), "");

    for (how, out) in [("--profile", &flagged), ("YAK_PROFILE", &yak), ("TASKS_PROFILE", &alias)] {
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(err.contains("── profile ──"), "{how}: {err}");
        assert!(err.contains("startup"), "{how}: {err}");
        assert!(err.contains("db.open"), "{how}: {err}");
        assert!(err.contains("vocab.init"), "{how}: {err}");
        assert!(err.contains("unaccounted"), "{how}: {err}");
        // sqlite was actually asked something, and the rows column filled in
        assert!(err.contains("sqlite_master"), "{how}: {err}");
        assert!(err.contains("rows"), "{how}: {err}");
    }
}
