// On shared storage a native search scans each vector's int8 codes once every
// vector has them, and answers what reading every float answers.
import { equal, ok, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { col, eq, insert, select, type Statements, table, val } from '@yaks/sql'
import { open } from '@yaks/sqlite/db'
import { statements } from '@yaks/sqlite'
import { SPINE, TOMBSTONE } from '../sqlite/testing.ts'
import { CODE, schema, TABLE } from './ddl.ts'
import { complete, heal } from './coded.ts'
import { install, prepare } from './native.ts'
import { nearest } from './near.ts'
import { put } from './sweep.ts'
import { pack, unit } from './vector.ts'

let dir = Deno.makeTempDirSync({ prefix: 'embedding-coded-' })
let driver = open(`${dir}/yak.db`), db = statements(driver)
driver.query({ t: 'pragma', name: 'synchronous', value: 'off' })
for (let s of [SPINE, TOMBSTONE, ...schema('shared')]) db.query(s)

let model = 'coded', DIM = 32
// A repeatable stream of numbers in [0, 1).
let seed = 11
let next = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
let centres = Array.from(
  { length: 12 },
  () => Float32Array.from({ length: DIM }, () => next() - 0.5),
)
let point = (id: number) =>
  unit(centres[id % 12].map((x) => x + (next() - 0.5) * 0.6))
let ids = Array.from({ length: 900 }, (_, i) => i + 1)
let vecs = new Map(ids.map((id) => [id, point(id)]))
db.query(insert('entity', ...ids.map((id) => ({ id, eid: `v-${id}` }))))
// Stored the way another writer stores them: no codes.
db.atomic(() => {
  for (let id of ids) {
    db.query(
      insert(TABLE, { owner: id, model, hash: '', vec: pack(vecs.get(id)!) }),
    )
  }
})
install(db)
prepare(db)

// Every scan a search ran, by the table it read.
let scans: string[] = []
let watched: Statements = {
  ...db,
  query: (s) => {
    let from = JSON.stringify(s).match(
      /vector_full_scan.{0,80}?"(embedding\w*)"/,
    )
    if (from) scans.push(from[1])
    return db.query(s)
  },
}
// The same database without the extension: every float read.
let plain: Statements = { ...db, facilities: undefined }
let names = (d: Statements, id: number) =>
  nearest(d, vecs.get(id)!, { model, limit: 8, without: `v-${id}` })
    .map((n) => n.entity)
let codes = () =>
  db.query(select({ cols: [col('owner')], from: table(CODE) })).length

test('vectors with no codes are scanned as floats until healed', () => {
  ok(!complete(db))
  scans = []
  equal(names(watched, 5), names(plain, 5))
  equal(scans, [TABLE])
  while (heal(db, 200));
  equal(codes(), ids.length)
  ok(complete(db))
})

test('a search over complete codes answers what the floats answer', () => {
  scans = []
  for (let id of [1, 77, 450, 899]) equal(names(watched, id), names(plain, id))
  ok(scans.every((s) => s == CODE) && scans.length >= 4, scans.join())
})

test('a changed or deleted vector loses its codes, and the sweep codes its own', () => {
  db.query({
    t: 'update',
    table: TABLE,
    set: { vec: val(pack(vecs.get(2)!)) },
    where: eq(col('owner'), val(1)),
  })
  db.query({ t: 'delete', from: TABLE, where: eq(col('owner'), val(3)) })
  equal(codes(), ids.length - 2)
  ok(!complete(db))
  vecs.set(1, vecs.get(2)!)
  equal(names(watched, 2), names(plain, 2))
  equal(heal(db), 1)
  put(db, { owner: 3, entity: 'v-3', text: 'three' }, model, vecs.get(3)!)
  ok(complete(db))
  scans = []
  equal(names(watched, 3), names(plain, 3))
  equal(scans, [CODE])
})

test('the test database is removed', () => {
  driver.close()
  Deno.removeSync(dir, { recursive: true })
})

let retryDriver = open(':memory:')
let retryBase = statements(retryDriver)
for (let s of [SPINE, TOMBSTONE, ...schema('shared')]) retryBase.query(s)
for (let id of [1, 2, 3]) {
  retryBase.query(insert('entity', { id, eid: `retry-${id}` }))
  retryBase.query(insert(TABLE, {
    owner: id,
    model,
    hash: '',
    vec: pack(vecs.get(id)!),
  }))
}
let refused = true
let retryDb: Statements = {
  ...retryBase,
  atomic: (body) => {
    if (refused) {
      refused = false
      throw new Error('entry refused')
    }
    return retryBase.atomic(body)
  },
}

test('a refused coding pass leaves its source cursor at the uncommitted rows', () => {
  try {
    assertThrows(() => heal(retryDb, 2), Error, 'entry refused')
    equal(heal(retryDb, 2), 2)
    equal(
      retryDb.query(select({
        cols: [col('owner')],
        from: table(CODE),
        order: [col('owner')],
      })),
      [{ owner: 1 }, { owner: 2 }],
    )
  } finally {
    retryDriver.close()
  }
})
