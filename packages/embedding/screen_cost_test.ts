// A selective screen stays selective after it grows beyond 5,000 owners.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { col, insert, le, render, select, table, val } from '@yaks/sql'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { statements } from '../sqlite/statements.ts'
import { SPINE, TOMBSTONE } from '../sqlite/testing.ts'
import { cleanup, equal, ok, test } from '@yaks/testing'
import { schema, TABLE } from './ddl.ts'
import { install, prepare } from './native.ts'
import { nearest } from './near.ts'
import { pack } from './vector.ts'

let native = new Database(':memory:'), base = driver(native), steps = 0
let api = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let db = statements({
  ...base,
  extension: (file: string) => {
    native.enableLoadExtension = true
    try {
      native.loadExtension(file)
    } finally {
      native.enableLoadExtension = false
    }
  },
  file: true,
  query: (s) => {
    let q = render(s), stmt = native.prepare(q.sql)
    try {
      let rows = stmt.all(...q.params)
      steps += api.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
      return rows
    } finally {
      stmt.finalize()
    }
  },
})
for (let s of [SPINE, TOMBSTONE, ...schema('shared')]) db.query(s)
let chosen = 5001, total = chosen * 9
let vector = Float32Array.of(1, 0)
for (let start = 1; start <= total; start += 500) {
  let ids = Array.from(
    { length: Math.min(500, total - start + 1) },
    (_, n) => start + n,
  )
  db.query(insert('entity', ...ids.map((id) => ({ id, eid: `v-${id}` }))))
  db.query(
    insert(
      TABLE,
      ...ids.map((id) => ({
        owner: id,
        model: 'one',
        hash: '',
        vec: pack(id <= chosen ? vector : Float32Array.of(0, 1)),
      })),
    ),
  )
}
install(db)
prepare(db)
let within = render(select({
  cols: [col('id')],
  from: table('entity'),
  where: le(col('id'), val(chosen)),
}))

test('nearest among a growing minority avoids visiting the unrelated corpus', () => {
  cleanup(() => {
    api.close()
    native.close()
  })
  steps = 0
  let hits = nearest(db, vector, { model: 'one', limit: 4, within })
  equal(hits.map((h) => h.entity), ['v-1', 'v-2', 'v-3', 'v-4'])
  ok(
    steps < total * 5,
    `${steps} instructions for ${chosen} of ${total} owners`,
  )
})
