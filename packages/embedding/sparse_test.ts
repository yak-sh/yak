import { cleanup, equal, ok, test } from '@yaks/testing'
import {
  col,
  gt,
  insert,
  render,
  select,
  type Statements,
  table,
  val,
} from '@yaks/sql'
import { open } from '@yaks/sqlite/db'
import { statements } from '@yaks/sqlite'
import { bury, SPINE, TOMBSTONE } from '../sqlite/testing.ts'
import { heal } from './coded.ts'
import { schema, TABLE } from './ddl.ts'
import { install, pool, prepare } from './native.ts'
import { nearest } from './near.ts'
import { pack } from './vector.ts'

let query = Float32Array.of(1, 0)
let within = render(select({
  cols: [col('id')],
  from: table('entity'),
  where: gt(col('id'), val(400)),
}))
let fixture = () => {
  let driver = open(':memory:')
  let db = statements(driver)
  for (let s of [SPINE, TOMBSTONE, ...schema('shared')]) db.query(s)
  db.atomic(() => {
    for (let id = 1; id <= 800; id++) {
      db.query(insert('entity', { id, eid: `v-${id}` }))
      db.query(insert(TABLE, {
        owner: id,
        model: 'one',
        hash: '',
        vec: pack(id <= 400 ? query : Float32Array.of(1, (801 - id) / 100)),
      }))
    }
  })
  heal(db, 800)
  install(db)
  prepare(db)
  let read = { floats: 0, codes: 0 }
  let counted: Statements = {
    ...db,
    ownership: 'shared',
    query: (s) => {
      let rows = db.query(s)
      read.floats += rows.filter((r) => r.vec instanceof Uint8Array).length
      read.codes += rows.filter((r) => r.code instanceof Uint8Array).length
      return rows
    },
  }
  let names = () =>
    nearest(counted, query, { model: 'one', within, limit: 4 })
      .map((n) => n.entity)
  return { db, counted, read, names, close: driver.close }
}

let selective = fixture()
bury(selective.db, 800)
test('a selective search ranks every admitted code and reads only the best floats', () => {
  cleanup(selective.close)
  equal(selective.names(), ['v-799', 'v-798', 'v-797', 'v-796'])
  equal(selective.read.codes, 399)
  ok(selective.read.floats <= pool(4), `${selective.read.floats} float rows`)
})

let incomplete = fixture()
// Updating the vector invalidates just its codes. The new nearest must still
// answer, though every other admitted owner still has codes.
incomplete.db.query({
  t: 'update',
  table: TABLE,
  set: { vec: val(pack(query)) },
  where: gt(col('owner'), val(799)),
})
test('an incomplete code table falls back without losing the updated neighbour', () => {
  cleanup(incomplete.close)
  equal(incomplete.names(), ['v-800', 'v-799', 'v-798', 'v-797'])
  equal(incomplete.read.floats, 400)
  equal(incomplete.read.codes, 0)
})

let mixed = fixture()
mixed.db.query(insert('entity', { id: 801, eid: 'other-model' }))
mixed.db.query(insert(TABLE, {
  owner: 801,
  model: 'other',
  hash: '',
  vec: pack(query),
}))
heal(mixed.db, 801)
test('a mixed model corpus keeps other spaces out of selective ranking', () => {
  cleanup(mixed.close)
  equal(mixed.names(), ['v-800', 'v-799', 'v-798', 'v-797'])
  equal(mixed.read.codes, 0)
})
