// Schema authority (D-22804 §8): the kernel creates a fresh graph and
// additively migrates an old one off db.ts's own captured DDL (schema_gen.rs).
//
// Byte-parity vs Deno is proven in TWO halves, each within ONE SQLite engine so
// no cross-version skew can flap:
//   - codegen (src/vocab/schema_capture.ts) proves a GUARDED replay of the
//     emitted ops reproduces a real Deno migrate() open() byte-for-byte — so
//     the emitted DDL IS Deno's schema.
//   - here, apply_schema IS that same guarded replay, so a fresh create equals
//     Deno's fresh schema; these tests prove the guard behaviour it rides on:
//     create stands up the whole schema, additive migration restores an old
//     shape exactly, and a re-migrate writes nothing.
// The cross-engine identity (Rust build vs Deno build) rests on the same-build
// rule the read parity harness already assumes (M-22673).

use rusqlite::Connection;
use yak_kernel::{apply_schema, WriteStore};

// sqlite_master (tables, indexes, triggers) PLUS pragma table_info for every
// table — the exact surfaces D-22804 §8 names. sqlite_master.sql equality is
// the stronger check (table_info is derived from it), but both are dumped so a
// failure names the divergence precisely.
fn snapshot(conn: &Connection) -> String {
    let mut out = String::new();
    let mut st = conn
        .prepare(
            "select type, name, sql from sqlite_master \
             where sql is not null order by type, name",
        )
        .unwrap();
    let rows = st
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })
        .unwrap();
    for row in rows {
        let (t, n, s) = row.unwrap();
        out.push_str(&format!("--[{t} {n}]--\n{s}\n"));
    }
    let mut ts =
        conn.prepare("select name from sqlite_master where type='table' order by name").unwrap();
    let tables: Vec<String> =
        ts.query_map([], |r| r.get(0)).unwrap().filter_map(|x| x.ok()).collect();
    for t in tables {
        out.push_str(&format!("==info {t}==\n"));
        let mut ci = conn
            .prepare(&format!(
                "select cid, name, type, \"notnull\", dflt_value, pk \
                 from pragma_table_info('{t}')"
            ))
            .unwrap();
        let rows = ci
            .query_map([], |r| {
                Ok(format!(
                    "{} {} {} {} {:?} {}",
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            })
            .unwrap();
        for row in rows {
            out.push_str(&row.unwrap());
            out.push('\n');
        }
    }
    out
}

fn has(conn: &Connection, kind: &str, name: &str) -> bool {
    conn.query_row("select 1 from sqlite_master where type = ?1 and name = ?2", [kind, name], |r| {
        r.get::<_, i64>(0)
    })
    .is_ok()
}

fn has_col(conn: &Connection, table: &str, col: &str) -> bool {
    conn.query_row("select 1 from pragma_table_info(?1) where name = ?2", [table, col], |r| {
        r.get::<_, i64>(0)
    })
    .is_ok()
}

// A fresh create stands up the whole schema: the spine, hand tables, derived
// tables, the FTS/gram virtual tables and their triggers, and the indexes the
// migrator realizes last.
#[test]
fn create_produces_the_full_schema() {
    let ws = WriteStore::create_or_migrate(":memory:").unwrap();
    let c = &ws.conn;
    for t in [
        "entity",
        "doc",
        "task",
        "session",
        "dependency",
        "journal",
        "journal_touch",
        "server_meta",
        "mail",
        "comment",
        "claim",
        // derived component tables
        "project",
        "board",
        "notice",
        "error",
        "deliver",
        "anchor",
        "meta",
        // fts virtual tables
        "doc_fts",
        "doc_gram",
    ] {
        assert!(has(c, "table", t), "missing table {t}");
    }
    for tr in ["doc_fts_ai", "doc_gram_au", "embedding_index_ad"] {
        assert!(has(c, "trigger", tr), "missing trigger {tr}");
    }
    // the bare index (guarded by name), a derived {eid} index, and the hand
    // edge-reverse index — all realized in the last pass.
    for i in ["journal_touch_eid", "notice_target", "dependency_child"] {
        assert!(has(c, "index", i), "missing index {i}");
    }
    // an ALTER-added column and a derived column both land.
    assert!(has_col(c, "task", "domain"));
    assert!(has_col(c, "error", "message"));
    // the epoch row was minted.
    let epoch: String =
        c.query_row("select v from server_meta where k = 'epoch'", [], |r| r.get(0)).unwrap();
    assert!(!epoch.is_empty());
}

// Additive migration restores an OLD shape to the current one, byte-for-byte,
// for the two forms whose fresh text is itself additive: a hand column added by
// ALTER, and a whole derived table (re)created by its `create if not exists`.
// (A re-added DERIVED column matches Deno's OWN migrated text, not the fresh
// inline text — proven by the codegen self-check, not assertable against fresh.)
#[test]
fn additive_migration_restores_the_old_shape() {
    let ws = WriteStore::create_or_migrate(":memory:").unwrap();
    let c = &ws.conn;
    let fresh = snapshot(c);

    // regress to a db that predates the last hand column and a derived table.
    c.execute_batch("alter table task drop column domain; drop table meta;").unwrap();
    assert_ne!(snapshot(c), fresh, "the regression must change the schema");
    assert!(!has_col(c, "task", "domain"));
    assert!(!has(c, "table", "meta"));

    apply_schema(c).unwrap();
    assert_eq!(snapshot(c), fresh, "migrate must restore the exact schema");
}

// A newly-derived column on an old db is grown in place by the derived
// add-column pass (the capture cannot see it on a fresh db, so schemaDdl splices
// it in). Here we can only assert the column returns — its stored text matches
// Deno's migrated form, which the codegen self-check holds, not the fresh form.
#[test]
fn additive_migration_re_adds_a_derived_column() {
    let ws = WriteStore::create_or_migrate(":memory:").unwrap();
    let c = &ws.conn;
    c.execute_batch("alter table error drop column message;").unwrap();
    assert!(!has_col(c, "error", "message"), "regressed away");
    apply_schema(c).unwrap();
    assert!(has_col(c, "error", "message"), "additive pass re-added it");
}

// A re-migrate over an already-current graph writes no schema change.
#[test]
fn migrate_is_idempotent() {
    let ws = WriteStore::create_or_migrate(":memory:").unwrap();
    let c = &ws.conn;
    let before = snapshot(c);
    apply_schema(c).unwrap();
    assert_eq!(snapshot(c), before, "a second migrate is a no-op on the schema");
}
