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
// (the library/bridge door) still never creates and never migrates. Production
// does not run the bridge against owner data; disposable parity graphs may use
// this transactional, idempotent migration door. The doc.body content-addressing
// reshape is the one explicit non-additive pass; it precedes the generated
// current schema and is tested against legacy data.

use crate::write::{has_col, sha, WriteStore};
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde_json::Value;
use std::time::Duration;

const SCHEMA_VERSION: i64 = 1;

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
    conn.query_row("select 1 from sqlite_master where type = 'index' and name = ?1", [name], |r| {
        r.get::<_, i64>(0)
    })
    .optional()
    .ok()
    .flatten()
    .is_some()
}

fn has_table(conn: &Connection, name: &str) -> bool {
    conn.query_row("select 1 from sqlite_master where type = 'table' and name = ?1", [name], |_| {
        Ok(())
    })
    .is_ok()
}

// Retire the JSON journal (db.ts retireJsonJournal, T-18883): the legacy
// `journal` (one JSON batch per row) and `journal_touch` (its seek index) are
// dropped once journal_tx holds a row for every parseable batch -- never
// history the normalized log does not carry. Guarded by table presence, so a
// later open is a pure read.
fn retire_json_journal(conn: &Connection) -> rusqlite::Result<()> {
    if !has_table(conn, "journal") {
        return Ok(());
    }
    let missing: i64 = conn.query_row(
        "select count(*) from journal j \
         where json_valid(j.batch) \
           and not exists (select 1 from journal_tx t where t.id = j.rowid)",
        [],
        |r| r.get(0),
    )?;
    if missing > 0 {
        return Ok(());
    }
    conn.execute_batch("drop table if exists journal_touch; drop table if exists journal;")?;
    conn.execute("delete from server_meta where k = 'journal_backfill'", [])?;
    Ok(())
}

// Key the journal by spine id (db.ts migrateJournalKeys, T-18883):
// journal_change.eid and journal_tx.actor/via were eid TEXT and are now
// integers into entity(id). Each table is rebuilt beside itself from the fresh
// DDL (a scratch graph hands it over, so this never restates the schema) and
// swapped in, keeping every id and resolving each eid through the spine; a
// change whose eid has no spine row keeps its tx and fields and names no
// entity. Guarded on the old column, so a later open is a pure read. Foreign
// keys are off on this connection, so the drops leave the kept children alone.
fn migrate_journal_keys(conn: &Connection) -> rusqlite::Result<()> {
    if !has_col(conn, "journal_change", "eid") {
        return Ok(());
    }
    let scratch = Connection::open_in_memory()?;
    apply_schema(&scratch)?;
    let ddl_of = |t: &str| -> rusqlite::Result<String> {
        let sql: String = scratch.query_row(
            "select sql from sqlite_master where type = 'table' and name = ?1",
            [t],
            |r| r.get(0),
        )?;
        Ok(sql.replacen(t, &format!("__mig_{t}"), 1))
    };
    let tx_ddl = ddl_of("journal_tx")?;
    let change_ddl = ddl_of("journal_change")?;
    conn.execute_batch(&tx_ddl)?;
    conn.execute_batch(
        "insert into __mig_journal_tx (id, ts, actor, via, trace) \
           select jt.id, jt.ts, a.id, v.id, jt.trace from journal_tx jt \
             left join entity a on a.eid = jt.actor \
             left join entity v on v.eid = jt.via; \
         drop table journal_tx; \
         alter table __mig_journal_tx rename to journal_tx;",
    )?;
    conn.execute_batch(&change_ddl)?;
    conn.execute_batch(
        "insert into __mig_journal_change (id, tx, ordinal, entity, component, operation) \
           select jc.id, jc.tx, jc.ordinal, e.id, jc.component, jc.operation \
             from journal_change jc left join entity e on e.eid = jc.eid; \
         drop table journal_change; \
         alter table __mig_journal_change rename to journal_change; \
         create index journal_change_tx on journal_change(tx, ordinal); \
         create index journal_change_ent on journal_change(entity, component);",
    )?;
    Ok(())
}

// `instruction` was the empty Session-prompt marker before executable
// instructions claimed that name. Move only that one-column legacy shape;
// contract-bearing instruction tables belong to the evaluator and must remain.
// Running before SCHEMA lets the ordinary generated `prompt` create serve both
// fresh databases and a renamed legacy table.
fn migrate_prompt(conn: &Connection) -> rusqlite::Result<()> {
    let mut st = conn.prepare("select name from pragma_table_info('instruction') order by cid")?;
    let cols: Vec<String> = st.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    if cols.len() != 1 || cols[0] != "entity" {
        return Ok(());
    }
    let prompt = conn
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = 'prompt'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
        .is_some();
    if prompt {
        conn.execute_batch(
            "insert or ignore into prompt (entity) select entity from instruction; \
             drop table instruction;",
        )?;
    } else {
        conn.execute_batch("alter table instruction rename to prompt;")?;
    }
    Ok(())
}

// doc.body speaks text on the wire but stores the id of the blob entity whose
// eid hashes those bytes. This one-time reshape mirrors db.ts and runs before
// the generated current schema creates the resolved view and derived indexes.
fn migrate_doc_bodies(conn: &Connection) -> rusqlite::Result<()> {
    let body_type = conn
        .query_row(
            "select lower(type) from pragma_table_info('doc') where name = 'body'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    if body_type.as_deref().map(|t| t == "integer").unwrap_or(true) {
        return Ok(());
    }

    conn.execute_batch("savepoint doc_bodies")?;
    let migrated = (|| -> rusqlite::Result<()> {
        conn.execute_batch(
            "drop trigger if exists doc_ai;
             drop trigger if exists doc_ad;
             drop trigger if exists doc_au;
             drop trigger if exists doc_fts_ai;
             drop trigger if exists doc_fts_ad;
             drop trigger if exists doc_fts_au;
             drop trigger if exists doc_gram_ai;
             drop trigger if exists doc_gram_ad;
             drop trigger if exists doc_gram_au;
             drop table if exists doc_fts;
             drop table if exists doc_gram;
             drop view if exists doc_value;
             create table if not exists blob (
               entity integer primary key references entity(id),
               bytes integer
             );
             create table if not exists blob_text (
               entity integer primary key references blob(entity),
               value text not null
             );
             alter table doc rename to __legacy_doc;
             create table doc (
               entity integer primary key references entity(id),
               title text not null,
               body integer not null references blob(entity)
             );",
        )?;
        let rows = {
            let mut st =
                conn.prepare("select entity, title, body from __legacy_doc order by entity")?;
            let rows = st
                .query_map([], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        for (entity, title, body) in rows {
            let eid = sha(&Value::from(body.as_str()));
            conn.execute("insert or ignore into entity (eid) values (?1)", [&eid])?;
            let blob: i64 =
                conn.query_row("select id from entity where eid = ?1", [&eid], |r| r.get(0))?;
            conn.execute(
                "insert or ignore into blob (entity, bytes) values (?1, ?2)",
                (blob, body.len() as i64),
            )?;
            conn.execute(
                "insert or ignore into blob_text (entity, value) values (?1, ?2)",
                (blob, body.as_str()),
            )?;
            conn.execute(
                "insert into doc (entity, title, body) values (?1, ?2, ?3)",
                (entity, title, blob),
            )?;
        }
        conn.execute_batch(
            "drop table __legacy_doc;
             create view doc_value as
               select d.entity as rowid, d.entity, d.title, b.value as body
               from doc d join blob_text b on b.entity = d.body;",
        )?;
        Ok(())
    })();
    match migrated {
        Ok(()) => conn.execute_batch("release doc_bodies"),
        Err(e) => {
            let _ = conn.execute_batch("rollback to doc_bodies; release doc_bodies;");
            Err(e)
        }
    }
}

// Replay the emitted DDL against a connection, applying each statement's guard.
// Idempotent: a re-run over an already-current graph writes nothing.
pub fn apply_schema(conn: &Connection) -> rusqlite::Result<()> {
    migrate_prompt(conn)?;
    migrate_doc_bodies(conn)?;
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
    retire_json_journal(conn)?;
    migrate_journal_keys(conn)?;
    conn.execute_batch(
        "insert or ignore into prompt (entity) \
         select e.entity from entry e \
         join message m on m.entity = e.entity \
         join session s on s.entity = e.session \
         where e.seq = 1 and m.role = 'user' and s.origin = 'managed';",
    )?;
    Ok(())
}

// Mint the durable sync epoch if absent (db.ts mintEpoch, T-20299) — the
// cursor-lineage identity a delta client checks. A WRITE, so it belongs in the
// migration transaction, never on a read path; `insert or ignore` keeps
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
    // transactional (unlike WriteStore::open, which never touches the schema).
    // The pragmas mirror db.ts migrate()'s boot writes: WAL header flip
    // (a no-op `memory` on :memory:) and its crash-safe `synchronous = normal`.
    pub fn create_or_migrate(path: &str) -> rusqlite::Result<WriteStore> {
        let mut conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_URI,
        )?;
        conn.busy_timeout(Duration::from_millis(5000))?;
        conn.pragma_update(None, "journal_mode", "wal")?;
        conn.pragma_update(None, "synchronous", "normal")?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Read the version after BEGIN IMMEDIATE. A concurrent newer migrator
        // may commit while this process waits for the write lock; a pre-lock
        // read would then let this older process overwrite its version.
        let stored: i64 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if stored > SCHEMA_VERSION {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "database schema version {stored} is newer than this binary's version {SCHEMA_VERSION}"
            )));
        }
        apply_schema(&tx)?;
        mint_epoch(&tx)?;
        if stored != SCHEMA_VERSION {
            tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        tx.commit()?;
        Ok(WriteStore { conn })
    }
}
