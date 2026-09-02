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

use crate::write::{has_col, sha, text_blob, WriteStore};
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

// Is the column declared NOT NULL? The guard a tightening migration reads.
fn col_not_null(conn: &Connection, t: &str, c: &str) -> bool {
    conn.query_row("select \"notnull\" from pragma_table_info(?1) where name = ?2", [t, c], |r| {
        r.get::<_, i64>(0)
    })
    .optional()
    .ok()
    .flatten()
        == Some(1)
}

// Every eid the journal names and no spine carries gets a RETAINED spine row
// and a grave (db.ts buryJournalOrphans): num stays null, deleted_at is the ts
// of the last transaction that named it, the grave written in whichever shape
// the table wears. Returns how many were buried.
fn bury_journal_orphans(conn: &Connection) -> rusqlite::Result<i64> {
    conn.execute_batch(
        "create temp table __orphan as \
           select eid, max(ts) as last from ( \
             select jc.eid as eid, jt.ts as ts \
               from journal_change jc join journal_tx jt on jt.id = jc.tx \
             union all select actor, ts from journal_tx where actor is not null \
             union all select via, ts from journal_tx where via is not null \
           ) where eid not in (select eid from entity) group by eid; \
         insert into entity (eid, num) select eid, null from __orphan;",
    )?;
    conn.execute_batch(if has_col(conn, "tombstone", "entity") {
        "insert or ignore into tombstone (entity, deleted_at) \
           select e.id, o.last from __orphan o join entity e on e.eid = o.eid;"
    } else {
        "insert or ignore into tombstone (eid, deleted_at) select eid, last from __orphan;"
    })?;
    let n: i64 = conn.query_row("select count(*) from __orphan", [], |r| r.get(0))?;
    conn.execute_batch("drop table __orphan;")?;
    Ok(n)
}

// Key the journal by spine id (db.ts migrateJournalKeys, T-18883):
// journal_change.eid and journal_tx.actor/via were eid TEXT and are now
// integers into entity(id), entity NOT NULL once the orphans are buried. Each
// table is rebuilt beside itself from the fresh DDL (a scratch graph hands it
// over, so this never restates the schema) and swapped in, keeping every id.
// The interim keyed shape (nullable entity, no eid column) tightens in place
// when nothing names no entity; a row that does has lost its eid and is left
// for a restore, never invented. Guarded, so a later open is a pure read.
// Needs foreign keys OFF (create_or_migrate lifts them before BEGIN, as db.ts
// migrate() does): the drops would otherwise cascade-check the child rows
// being kept.
pub fn journal_keyed(conn: &Connection) -> bool {
    !has_table(conn, "journal_change")
        || (!has_col(conn, "journal_change", "eid")
            && col_not_null(conn, "journal_change", "entity"))
}

fn migrate_journal_keys(conn: &Connection) -> rusqlite::Result<()> {
    if journal_keyed(conn) {
        return Ok(());
    }
    let text = has_col(conn, "journal_change", "eid");
    if !text {
        let lost: i64 =
            conn.query_row("select count(*) from journal_change where entity is null", [], |r| {
                r.get(0)
            })?;
        if lost > 0 {
            return Ok(());
        }
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
    if text {
        bury_journal_orphans(conn)?;
        conn.execute_batch(&tx_ddl)?;
        conn.execute_batch(
            "insert into __mig_journal_tx (id, ts, actor, via, trace) \
               select jt.id, jt.ts, a.id, v.id, jt.trace from journal_tx jt \
                 left join entity a on a.eid = jt.actor \
                 left join entity v on v.eid = jt.via; \
             drop table journal_tx; \
             alter table __mig_journal_tx rename to journal_tx;",
        )?;
    }
    conn.execute_batch(&change_ddl)?;
    conn.execute_batch(if text {
        "insert into __mig_journal_change (id, tx, ordinal, entity, component, operation) \
           select jc.id, jc.tx, jc.ordinal, e.id, jc.component, jc.operation \
             from journal_change jc join entity e on e.eid = jc.eid;"
    } else {
        "insert into __mig_journal_change (id, tx, ordinal, entity, component, operation) \
           select id, tx, ordinal, entity, component, operation from journal_change;"
    })?;
    conn.execute_batch(
        "drop table journal_change; \
         alter table __mig_journal_change rename to journal_change; \
         create index journal_change_tx on journal_change(tx, ordinal); \
         create index journal_change_ent on journal_change(entity, component);",
    )?;
    Ok(())
}

// The components whose history the journal keeps (db.ts JOURNAL_KEEP).
const JOURNAL_KEEP: &[&str] = &[
    "doc",
    "task",
    "comment",
    "memory",
    "design",
    "goal",
    "commit",
    "project",
    "persona",
    "dependency",
    "claim",
    "decided",
    "proposed",
    "completed",
    "cancelled",
    "created",
    "updated",
    "mail",
    "deliver",
    "person",
    "feedback",
    "review",
    "quarantined",
    "accept",
    "verifier",
    "noverify",
    "finding",
    "bug",
    "notice",
    "brief",
    "patch",
    "alias",
];

// Collect the journal once (db.ts gcJournal, T-18883): the same deletes in the
// same order, marked in server_meta so a later open is a pure read.
fn gc_journal(conn: &Connection) -> rusqlite::Result<()> {
    if !has_table(conn, "journal_change")
        || conn
            .query_row("select 1 from server_meta where k = 'journal_gc'", [], |_| Ok(()))
            .optional()?
            .is_some()
    {
        return Ok(());
    }
    let keep = JOURNAL_KEEP.iter().map(|c| format!("'{c}'")).collect::<Vec<_>>().join(", ");
    conn.execute_batch(&format!(
        "delete from journal_field where change in \
           (select id from journal_change where component not in ({keep}, 'entity', 'blob')); \
         delete from journal_change where component not in ({keep}, 'entity', 'blob'); \
         delete from journal_field where field = 'eid'; \
         delete from journal_field where change in \
           (select id from journal_change jc where jc.component in ('entity', 'blob') \
             and not exists (select 1 from journal_change o \
               where o.entity = jc.entity and o.component not in ('entity', 'blob'))); \
         delete from journal_change where component in ('entity', 'blob') \
           and not exists (select 1 from journal_change o \
             where o.entity = journal_change.entity \
               and o.component not in ('entity', 'blob')); \
         delete from journal_field where id in ( \
           select id from ( \
             select jf.id as id, jf.present as present, jf.value as value, \
                    lag(jf.value) over ( \
                      partition by jc.entity, jc.component, jf.field \
                      order by jc.tx, jc.ordinal, jf.ordinal) as prev \
               from journal_field jf join journal_change jc on jc.id = jf.change) \
            where present = 1 and value = prev); \
         delete from journal_change where id in ( \
           select id from ( \
             select jc.id as id, jc.operation as op, \
                    lag(jc.operation) over ( \
                      partition by jc.entity, jc.component \
                      order by jc.tx, jc.ordinal) as prev, \
                    (select count(*) from journal_field jf where jf.change = jc.id) as n \
               from journal_change jc) \
            where op = 'upsert' and n = 0 and prev = 'upsert'); \
         delete from journal_tx where not exists \
           (select 1 from journal_change jc where jc.tx = journal_tx.id); \
         drop table if exists lost_and_found; \
         drop table if exists lost_and_found_0; \
         insert or ignore into server_meta (k, v) values ('journal_gc', '1');"
    ))?;
    Ok(())
}

// Share the graph's bytes with its history (db.ts migrateJournalRefs): a
// journaled doc.body still carrying its text is pointed at its content blob
// (minted through text_blob if absent) and the copy dropped; every `eid`
// field row goes. Guarded on the ref column; the ref index is realized on
// every shape.
fn migrate_journal_refs(conn: &Connection) -> rusqlite::Result<()> {
    if !has_table(conn, "journal_field") {
        return Ok(());
    }
    if !has_col(conn, "journal_field", "ref") {
        conn.execute_batch(
            "alter table journal_field add column ref integer references entity(id);",
        )?;
        let rows: Vec<(i64, String)> = {
            let mut st = conn.prepare(
                "select jf.id, jf.value \
                   from journal_field jf join journal_change jc on jc.id = jf.change \
                  where jc.component = 'doc' and jf.field = 'body' \
                    and jf.present = 1 and jf.value is not null",
            )?;
            let rows = st
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        for (id, value) in rows {
            let Ok(Value::String(text)) = serde_json::from_str::<Value>(&value) else {
                continue;
            };
            let blob = text_blob(conn, &text)?;
            conn.execute(
                "update journal_field set ref = ?1, value = null where id = ?2",
                rusqlite::params![blob, id],
            )?;
        }
        conn.execute("delete from journal_field where field = 'eid'", [])?;
    }
    if !has_idx(conn, "journal_field_ref") {
        conn.execute_batch(
            "create index journal_field_ref on journal_field(ref) where ref is not null;",
        )?;
    }
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
    gc_journal(conn)?;
    migrate_journal_refs(conn)?;
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
        // The journal rekey drops parent tables whose children it keeps, so
        // it runs with enforcement off; the pragma is ignored inside a
        // transaction, so it is set before BEGIN and restored after.
        let rekey = !journal_keyed(&conn);
        if rekey {
            conn.pragma_update(None, "foreign_keys", false)?;
        }
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
        if rekey {
            conn.pragma_update(None, "foreign_keys", true)?;
        }
        Ok(WriteStore { conn })
    }
}
