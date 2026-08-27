// Does a long-lived READ-ONLY connection see commits made by ANOTHER
// connection in WAL mode? This is the premise of the WS live stream (a
// persistent read-only Store + journal cursor beside the writer). Gated on
// WAL_PROBE_DB pointing at a WAL copy (a rw connection here does the writing).

use rusqlite::{Connection, OpenFlags};

#[test]
fn readonly_sees_foreign_commits() {
    let Some(path) = std::env::var("WAL_PROBE_DB").ok().filter(|s| !s.is_empty()) else {
        eprintln!("readonly_sees_foreign_commits: skipped (set WAL_PROBE_DB)");
        return;
    };
    // writer (read-write), reader (read-only) — two connections, one file.
    let rw = Connection::open(&path).expect("open rw");
    rw.busy_timeout(std::time::Duration::from_millis(5000)).unwrap();
    let ro = Connection::open_with_flags(
        format!("file:{path}?mode=ro"),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .expect("open ro");

    rw.execute_batch("create table if not exists _walprobe(n integer)").ok();
    let dv =
        |c: &Connection| -> i64 { c.query_row("pragma data_version", [], |r| r.get(0)).unwrap() };
    let count = |c: &Connection| -> i64 {
        c.query_row("select count(*) from _walprobe", [], |r| r.get(0)).unwrap_or(-1)
    };

    let v0 = dv(&ro);
    let c0 = count(&ro);
    rw.execute("insert into _walprobe(n) values (1)", []).unwrap();
    let v1 = dv(&ro);
    let c1 = count(&ro);
    eprintln!("same-process: ro data_version {v0} -> {v1}   count {c0} -> {c1}");
    assert_ne!(v0, v1, "read-only data_version did NOT change on a same-process commit");
    assert_eq!(c1, c0 + 1, "read-only did NOT see the same-process insert");

    // Now a DIFFERENT PROCESS writes — the real WS scenario (the Deno server
    // commits, the bridge's persistent read-only connection must see it).
    let out = std::process::Command::new("sqlite3")
        .arg(&path)
        .arg("insert into _walprobe(n) values (2);")
        .output()
        .expect("sqlite3 subprocess");
    assert!(out.status.success(), "sqlite3 insert failed: {out:?}");
    let v2 = dv(&ro);
    let c2 = count(&ro);
    eprintln!("cross-process: ro data_version {v1} -> {v2}   count {c1} -> {c2}");

    rw.execute("drop table if exists _walprobe", []).ok();
    assert_ne!(v1, v2, "read-only data_version did NOT change on a CROSS-PROCESS commit");
    assert_eq!(c2, c1 + 1, "read-only did NOT see the CROSS-PROCESS insert");
}
