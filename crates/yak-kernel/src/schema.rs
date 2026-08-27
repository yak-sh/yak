// Schema authority (D-22804 §8), ported from src/db.ts open() = connect() +
// migrate(). Until now the kernel encoded NEVER-CREATE / NEVER-MIGRATE: a
// library writer opens an existing schema and leaves it alone (store.rs,
// write.rs). The Deno→Rust swap needs the OTHER half — after the swap there is
// no Deno open() to create a fresh graph or run the next additive `alter table`
// — so this module gives the kernel that capability, off db.ts's OWN schema.
//
// The DDL is not hand-copied. `deno task codegen` captures the ordered DDL a
// fresh migrate() runs (recorded through the live SQLite driver) and emits it
// into schema_gen.rs as SCHEMA, guarded by the codegen stale check — so db.ts
// stays the one schema source and a Rust schema can never drift from it. Each
// statement carries its own guard class: an idempotent create/drop runs as-is;
// an `add column` runs only when the column is absent (additive migration); a
// bare `create index` runs only when the index is absent. On a FRESH file every
// guard passes and the whole list runs, producing the exact schema Deno's
// migrate() produces; on an EXISTING file only the missing columns and indexes
// are added — additive only, "anything shapier needs the owner" (M-17876).
//
// This is a DELIBERATE capability, never the default open. WriteStore::open
// (the library/bridge door) still never creates and never migrates; the swap's
// successor calls create_or_migrate ONCE, holding the writer baton, before it
// serves — mirroring Deno's sole-writer open() (baton.ts, D-22804 §8).

use crate::write::{has_col, WriteStore};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::time::Duration;

pub enum SchemaOp {
    // A create/drop that carries its own `if [not] exists` — idempotent, run
    // as-is. The one multi-statement blob (db.ts's hand `schema` string) rides
    // here too; execute_batch runs its whole sequence.
    Exec(&'static str),
    // `alter table <table> add column <col> …` — run only when <col> is absent.
    AddColumn { table: &'static str, col: &'static str, sql: &'static str },
    // A bare `create index <name> …` (no `if not exists`) — run only when the
    // index is absent, the same presence guard db.ts's hasIdx applies.
    Index { name: &'static str, sql: &'static str },
}

// Is this named index already present? The index twin of write.rs's has_col.
fn has_idx(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "select 1 from sqlite_master where type = 'index' and name = ?1",
        [name],
        |r| r.get::<_, i64>(0),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

// Replay the emitted DDL against a connection, applying each statement's guard.
// Idempotent: a re-run over an already-current graph writes nothing.
pub fn apply_schema(conn: &Connection) -> rusqlite::Result<()> {
    for op in crate::schema_gen::SCHEMA {
        match op {
            SchemaOp::Exec(sql) => conn.execute_batch(sql)?,
            SchemaOp::AddColumn { table, col, sql } => {
                if !has_col(conn, table, col) {
                    conn.execute_batch(sql)?;
                }
            }
            SchemaOp::Index { name, sql } => {
                if !has_idx(conn, name) {
                    conn.execute_batch(sql)?;
                }
            }
        }
    }
    Ok(())
}

// Mint the durable sync epoch if absent (db.ts mintEpoch, T-20299) — the
// cursor-lineage identity a delta client checks. A WRITE, so it belongs in the
// migrate phase under the baton, never on a read path; `insert or ignore` keeps
// a re-open a no-op. Its uuid is per-graph identity, so it is deliberately NOT
// part of byte-parity (each fresh graph mints its own).
pub fn mint_epoch(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "insert or ignore into server_meta (k, v) values ('epoch', ?1)",
        [uuid::Uuid::new_v4().to_string()],
    )?;
    Ok(())
}

impl WriteStore {
    // Create a fresh graph, or additively migrate an existing one, then return a
    // read-write handle — the schema-authority door (D-22804 §8). DELIBERATE and
    // caller-baton-guarded (unlike WriteStore::open, which never touches the
    // schema). The pragmas mirror db.ts migrate()'s boot writes: WAL header flip
    // (a no-op `memory` on :memory:) and its crash-safe `synchronous = normal`.
    pub fn create_or_migrate(path: &str) -> rusqlite::Result<WriteStore> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_URI,
        )?;
        conn.busy_timeout(Duration::from_millis(5000))?;
        conn.pragma_update(None, "journal_mode", "wal")?;
        conn.pragma_update(None, "synchronous", "normal")?;
        apply_schema(&conn)?;
        mint_epoch(&conn)?;
        Ok(WriteStore { conn })
    }
}
