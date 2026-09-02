// The store seam's contract, held against db.ts through a second handle: one
// that wraps the file adapter and answers `can` differently. A store without
// FTS5 still migrates, and its search door says so; an empty handle planted
// from schemaDdl() serves the wire like a migrated one.
Deno.env.set('DB_PATH', ':memory:')
import { assertEquals, assertThrows } from '@std/assert'
import { slow } from '../testing.ts'
import type { Can, Sql } from './sql.ts'
let { DatabaseSync } = await import('./sqlite.ts')
let { apply, migrate, plant, schemaDdl, search, snapshot } = await import(
  '../db.ts'
)

// A backend is whatever answers Sql: delegate to the adapter, own the `can`.
let backend = (can: Can): Sql => {
  let db = new DatabaseSync(':memory:')
  return {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    get inTransaction() {
      return db.inTransaction
    },
    get lastInsertRowId() {
      return db.lastInsertRowId
    },
    get isOpen() {
      return db.isOpen
    },
    can,
    close: () => db.close(),
  }
}

let tables = (db: Sql) =>
  (db.prepare(
    `select name from sqlite_master where type = 'table' order by name`,
  ).all() as { name: string }[]).map((r) => r.name)

slow('a store without FTS5 migrates whole and its search says so', () => {
  let db = migrate(backend({ fts: false }))
  assertEquals(tables(db).some((t) => t.startsWith('doc_fts')), false)
  assertEquals(tables(db).includes('task'), true)
  assertThrows(() => search(db, 'anything'), Error, 'FTS5')
  db.close()
})

slow('plant() from schemaDdl() serves the wire without a migration', () => {
  let ops = schemaDdl(new DatabaseSync(':memory:'))
  let db = plant(backend({ fts: true }), ops)
  let eid = crypto.randomUUID()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'planted' } },
    { eid, name: 'task', comp: { priority: 1 } },
  ])
  let doc = snapshot(db).changes.find((c) => c.eid == eid && c.name == 'doc')
  assertEquals((doc?.comp as { title?: string })?.title, 'planted')
  db.close()
})
