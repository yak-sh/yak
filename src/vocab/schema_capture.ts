// Codegen helper (D-22804 §8): print the ordered, classified schema DDL a fresh
// migrate() runs, as JSON, so src/vocab/gen.ts can emit the kernel's schema_gen.rs
// from it. Run as a SUBPROCESS (not imported) so it reads the freshly-written
// on-disk src/types.ts — the vocabulary a derived table's columns derive from —
// rather than a stale copy cached at gen.ts's own import time. Writes to the
// path in argv[0] (never stdout, which a driver notice could otherwise pollute).
//
// Before it writes, it PROVES the emitted list reconstructs Deno's own schema:
// a GUARDED replay of the ops (the exact logic the Rust kernel's apply_schema
// runs) into a fresh db must equal a real migrate() open() byte-for-byte. So a
// mis-captured or mis-classified op fails the codegen, not a later Rust boot.
import { open, schemaDdl, type SchemaOp } from '../db.ts'
import { DatabaseSync } from '../sqlite.ts'

let out = Deno.args[0]
if (!out) throw new Error('schema_capture: needs an output path argument')

let ops = schemaDdl()

// The guard logic the Rust kernel replays with (schema.rs apply_schema): an
// idempotent create/drop runs as-is; an add-column runs only when absent; a
// bare create-index runs only when absent.
let hasCol = (db: DatabaseSync, t: string, c: string) =>
  (db.prepare(`select name from pragma_table_info('${t}')`)
    .all() as { name: string }[]).some((r) => r.name === c)
let hasIdx = (db: DatabaseSync, name: string) =>
  !!db.prepare(
    `select 1 from sqlite_master where type='index' and name=?`,
  ).get(name)
let replay = (db: DatabaseSync, ops: SchemaOp[]) => {
  for (let op of ops) {
    if (op.kind === 'addColumn') {
      if (!hasCol(db, op.table, op.col)) db.exec(op.sql)
    } else if (op.kind === 'index') {
      if (!hasIdx(db, op.name)) db.exec(op.sql)
    } else db.exec(op.sql)
  }
}

let dump = (db: DatabaseSync) =>
  (db.prepare(
    'select type, name, sql from sqlite_master where sql is not null order by type, name',
  ).all() as { type: string; name: string; sql: string }[])
    .map((r) => `--[${r.type} ${r.name}]--\n${r.sql}`).join('\n')

let truth = dump(open(':memory:'))
let replayed = new DatabaseSync(':memory:')
replay(replayed, ops)
let got = dump(replayed)
if (truth !== got) {
  throw new Error(
    'schema_capture: guarded replay of schemaDdl() does NOT reproduce ' +
      "Deno's fresh migrate() — the emitted DDL is not byte-faithful",
  )
}

Deno.writeTextFileSync(out, JSON.stringify(ops))
