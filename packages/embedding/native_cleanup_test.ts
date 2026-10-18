// The one-time quantization cleanup preserves every canonical vector byte.
import { equal, test } from '@yaks/testing'
import { as, call, fn, insert, lit, select, table, val } from '@yaks/sql'
import { statements } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { retire } from '../../bin/retire-quantized-vectors.ts'
import { SPINE, TOMBSTONE } from '../sqlite/testing.ts'
import { BUILD, schema, TABLE } from './ddl.ts'
import { install, prepare, state } from './native.ts'
import { nearest } from './near.ts'

let dir = Deno.makeTempDirSync({ prefix: 'embedding-retire-' })
let driver = open(`${dir}/vectors.db`)
let db = statements(driver)
for (let s of [SPINE, TOMBSTONE, ...schema()]) db.query(s)
let vec = (values: number[]) => new Uint8Array(Float32Array.from(values).buffer)
db.query(insert('entity', { id: 1, eid: 'one' }, { id: 2, eid: 'two' }))
db.query(
  insert(TABLE, { owner: 1, model: 'm', hash: 'one', vec: vec([1, 0]) }, {
    owner: 2,
    model: 'm',
    hash: 'two',
    vec: vec([0, 1]),
  }),
)
install(db)
for (
  let [name, options] of [
    ['vector_init', 'type=FLOAT32,dimension=2,distance=COSINE,qtype=TURBO2'],
    ['vector_quantize', 'qtype=TURBO2'],
  ]
) {
  db.query(select({
    cols: [as(fn(name, lit(TABLE), lit('vec'), lit(options)), 'out')],
  }))
}
db.query({
  t: 'update',
  table: BUILD,
  set: { n: lit(1), model: lit('m'), dim: lit(2), rows: lit(2) },
})
let rows = () => db.query(select({ from: table(TABLE) }))
let before = rows()
let other = open(`${dir}/vectors.db`)
let reader = statements(other)
let scan = () =>
  db.query(select({
    from: call('vector_quantize_scan', [
      lit(TABLE),
      lit('vec'),
      val(vec([1, 0])),
      lit(2),
    ]),
  }))
let codes = scan()
let revision = db.revision('data')
prepare(reader)
let unchanged = db.revision('data') == revision
let oldSearch = scan()
other.close()
let removed = retire(db)
let after = rows()
let again = retire(db)
let found = nearest(db, Float32Array.of(1, 0), { model: 'm', limit: 1 })
let health = state(db)
for (let s of schema(db.ownership)) db.query(s)
db.query(insert('entity', { id: 3, eid: 'three' }))
db.query(insert(TABLE, { owner: 3, model: 'm', hash: '', vec: vec([1, 1]) }))
let written = nearest(db, Float32Array.of(1, 1), { model: 'm', limit: 1 })
driver.close()
Deno.removeSync(dir, { recursive: true })

test('retiring native codes preserves canonical bytes and exact search', () => {
  equal(removed, { before: 2, after: 2, removed: true })
  equal(after, before)
  equal(again, { before: 2, after: 2, removed: false })
  equal(found.map((r) => r.entity), ['one'])
})

test('new registration leaves a draining quantized reader unchanged', () => {
  equal(unchanged, true)
  equal(oldSearch, codes)
})

test('shared stores search new writes after retiring change tracking', () => {
  equal(health.dirty, 0)
  equal(written.map((r) => r.entity), ['three'])
})
