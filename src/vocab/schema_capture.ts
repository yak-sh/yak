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
import { plant, schemaDdl } from '../db.ts'
import { DatabaseSync, open } from '../store/sqlite.ts'

let out = Deno.args[0]
if (!out) throw new Error('schema_capture: needs an output path argument')

let ops = schemaDdl(new DatabaseSync(':memory:'))

// SQLite's own tables (sqlite_stat1, written by open()'s ANALYZE) are planner
// state, not schema we emit, so they sit outside the comparison.
let dump = (db: DatabaseSync) =>
  (db.prepare(
    `select type, name, sql from sqlite_master where sql is not null
     and name not like 'sqlite_%' order by type, name`,
  ).all() as { type: string; name: string; sql: string }[])
    .map((r) => `--[${r.type} ${r.name}]--\n${r.sql}`).join('\n')

let truth = dump(open(':memory:'))
// plant() is the guarded replay itself (the logic the Rust kernel's
// apply_schema runs), so this proof also covers a fresh backend's door.
let got = dump(plant(new DatabaseSync(':memory:'), ops))
if (truth !== got) {
  throw new Error(
    'schema_capture: guarded replay of schemaDdl() does NOT reproduce ' +
      "Deno's fresh migrate() — the emitted DDL is not byte-faithful",
  )
}

Deno.writeTextFileSync(out, JSON.stringify(ops))
