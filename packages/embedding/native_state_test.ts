// Native scans require a single model. Checking that model must seek the
// model index rather than reading every stored vector.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type Driver, insert, render } from '@yaks/sql'
import { statements } from '@yaks/sqlite'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { SPINE, TOMBSTONE } from '../sqlite/testing.ts'
import { schema, TABLE } from './ddl.ts'
import { state } from './native.ts'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
}).symbols.sqlite3_stmt_status
let native = new Database(':memory:')
let plain = driver(native)
let steps = 0
let counted: Driver = {
  ...plain,
  query: (s) => {
    if (s.t != 'select') return plain.query(s)
    let text = render(s), stmt = native.prepare(text.sql)
    try {
      let rows = stmt.all(...text.params)
      steps += status(stmt.unsafeHandle, 4, 0)
      return rows
    } finally {
      stmt.finalize()
    }
  },
}
let db = statements(counted)
for (let s of [SPINE, TOMBSTONE, ...schema()]) db.query(s)
let empty = state(db).model
let add = (start: number, n: number, model: string) => {
  for (let i = start; i < start + n; i += 200) {
    let ids = Array.from(
      { length: Math.min(200, start + n - i) },
      (_, j) => i + j,
    )
    db.query(insert('entity', ...ids.map((id) => ({ id, eid: `v-${id}` }))))
    db.query(insert(
      TABLE,
      ...ids.map((owner) => ({
        owner,
        model,
        hash: '',
        vec: new Uint8Array(4),
      })),
    ))
  }
  db.query({ t: 'delete', from: 'embedding_dirty' })
}
let read = () => {
  steps = 0
  let found = state(db)
  return { model: found.model, steps }
}
add(1, 1, 'one')
let small = read()
add(2, 2000, 'one')

test('an idle index model check stays bounded as the vector corpus grows', () => {
  let large = read()
  assertEquals([empty, small.model, large.model], [null, 'one', 'one'])
  assert(large.steps < 200, `${small.steps} -> ${large.steps} VM steps`)
})

// Mixing model spaces must never produce an index built for just one of them.
let mixed = new Database(':memory:')
let mixedDb = statements(driver(mixed))
for (let s of [SPINE, TOMBSTONE, ...schema()]) mixedDb.query(s)
mixedDb.query(insert('entity', { id: 1, eid: 'a' }, { id: 2, eid: 'b' }))
mixedDb.query(insert(
  TABLE,
  { owner: 1, model: 'one', hash: '', vec: new Uint8Array(4) },
  { owner: 2, model: 'two', hash: '', vec: new Uint8Array(4) },
))

test('an index model check rejects a corpus spanning two models', () => {
  assertEquals(state(mixedDb).model, null)
})
