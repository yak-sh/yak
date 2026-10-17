// A sparse transcript must not visit the requests belonging to other owners.
import { equal, ok, test } from '@yaks/testing'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { as, col, eq, insert, render, select, table, val } from '@yaks/sql'
import { driver } from '../sqlite/native.ts'
import { sessionDoc } from './comp.ts'
import { sessionDerived } from './status.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { effectDoc } from '@yaks/effects'
import { archetypeDoc } from '@yaks/archetype/vocab'

let vocab = loadVocab([
  sessionDoc,
  toolsDoc,
  modelDoc,
  kernelDoc,
  effectDoc,
  archetypeDoc,
], [kernelKeywords])
let db = new Database(':memory:')
let d = driver(db)
let store = storage(d, vocab, { derived: sessionDerived(vocab) })
store.install()
let write = (name: string, row: Record<string, string | number>) => {
  let q = render(insert(name, row))
  db.exec(q.sql, ...q.params)
}
write('entity', { id: 900001, eid: 'shape' })
write('archetype', {
  entity: 900001,
  tables: JSON.stringify(['content', 'entry']),
})
write('entity', { id: 1, eid: 'owner' })
write('session', { entity: 1, id: 'owner' })
write('entity', { id: 2, eid: 'input', archetype: 900001 })
write('entry', { entity: 2, session: 1, seq: 1 })
write('content', { entity: 2, body: 'hi' })
write('entity', { id: 3, eid: 'other' })
write('session', { entity: 3, id: 'other' })
for (let i = 10; i < 1010; i++) {
  write('entity', { id: i, eid: `unrelated-${i}` })
  write('entry', { entity: i, session: 3, seq: i })
  write('ask', { entity: i, through: 2 })
  if (i == 10) db.exec('ANALYZE')
}
let query = render(select({
  cols: [
    as(
      sessionDerived(vocab)['session.status'].expr(col('entity', 's')),
      'status',
    ),
  ],
  from: table('session', 's'),
  where: eq(col('entity', 's'), val(1)),
}))
let stmt = db.prepare(query.sql)
let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
// Preparing, seeding, and warming are setup, not the behavior being timed.
stmt.all(...query.params)
counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 1)
counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 1)

test('a sparse status read is bounded beside unrelated requests', () => {
  counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 1)
  counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 1)
  let rows = stmt.all(...query.params)
  equal(Object.values(rows[0])[0], 'running')
  let steps = counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
  let scans = counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 0)
  ok(
    steps < 2500,
    `${steps} VM steps / ${scans} full-scan steps beside 1000 unrelated requests`,
  )
  ok(scans < 100, `${scans} full-scan steps beside 1000 unrelated requests`)
})
