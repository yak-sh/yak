// The copy held in memory answers what reading every vector answers: as it
// loads, after any write behind its back, and after another driver clears the
// dirty set it reads. The corpus is ten times what a search re-scores, so the
// int8 scan decides which vectors reach the float rows.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import {
  among,
  col,
  type Driver,
  eq,
  gt,
  insert,
  render,
  select,
  table,
  val,
} from '@yaks/sql'
import { open } from '@yaks/sqlite/db'
import { bury, SPINE, TOMBSTONE } from '../sqlite/testing.ts'
import { schema, TABLE } from './ddl.ts'
import { absorb, hold, RESCORE } from './held.ts'
import { nearest, type NearOpts } from './near.ts'
import { pack, unit, unpack } from './vector.ts'

let model = 'clusters'
let DIM = 32

// A repeatable stream of numbers in [0, 1).
let random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
let next = random(3)
let centres = Array.from(
  { length: 12 },
  () => Float32Array.from({ length: DIM }, () => next() - 0.5),
)
let point = (i: number) =>
  unit(centres[i % 12].map((x) => x + (next() - 0.5) * 0.6))

// Entities `v-<id>`, each with a vector around one of twelve centres, of
// length 1, 4 or 16: its direction is what ranks.
let N = 5 * RESCORE
let corpus = () => {
  let db = open(':memory:')
  for (let s of [SPINE, TOMBSTONE, ...schema()]) db.query(s)
  let ids = Array.from({ length: N }, (_, i) => i + 1)
  db.query(insert('entity', ...ids.map((id) => ({ id, eid: `v-${id}` }))))
  db.query(insert(
    TABLE,
    ...ids.map((id) => ({
      owner: id,
      model,
      hash: '',
      vec: pack(point(id).map((x) => x * 4 ** (id % 3))),
    })),
  ))
  return db
}

// The same database as a file other processes may have open: read row by row.
let read = (db: Driver): Driver => ({ ...db, file: true })

let queries = Array.from({ length: 4 }, (_, i) => point(i))
let screens = [
  undefined,
  // a few
  render(select({
    cols: [col('id')],
    from: table('entity'),
    where: among(col('id'), [3, 50, 97, 131, 188].map((n) => val(n))),
  })),
  // most
  render(select({
    cols: [col('id')],
    from: table('entity'),
    where: gt(col('id'), val(40)),
  })),
]

// Every query, under every screen, answered alike by the copy and the rows.
let alike = (db: Driver, opts: Partial<NearOpts> = {}) => {
  for (let q of queries) {
    for (let within of screens) {
      let o = { model, limit: 8, within, ...opts }
      assertEquals(nearest(db, q, o), nearest(read(db), q, o))
    }
  }
}

// A copy as each owner's scale and codes, whichever slot holds them.
let copy = (db: Driver) => {
  let h = hold(db, model)!
  return new Map(
    [...h.slot].map(([owner, i]) => [
      owner,
      [h.scales[i], ...h.codes.subarray(i * h.dim, (i + 1) * h.dim)],
    ]),
  )
}

let top = (db: Driver, q: Float32Array) =>
  nearest(db, q, { model, limit: 3 }).map((n) => n.entity)

test('the copy answers what reading every vector answers', () => {
  let db = corpus()
  alike(db)
  alike(db, { limit: 30, floor: 0.5 })
  alike(db, { without: 'v-12' })
})

test('a write or delete after the copy loaded counts as it stands', () => {
  let db = corpus()
  let q = queries[0]
  let [first] = top(db, q)
  // the last vector held, which moves into the slot a delete frees
  let last = unpack(
    db.query(select({ from: table(TABLE), where: eq(col('owner'), val(N)) }))[0]
      .vec as Uint8Array,
  )
  db.query(insert('entity', { id: N + 1, eid: `v-${N + 1}` }))
  db.query(insert(TABLE, { owner: N + 1, model, hash: '', vec: pack(q) }))
  db.query({ t: 'delete', from: TABLE, where: eq(col('owner'), val(12)) })
  db.query({
    t: 'update',
    table: TABLE,
    set: { vec: val(pack(point(7))) },
    where: eq(col('owner'), val(Number(first.slice(2)))),
  })
  // one far from q, moved onto it
  let far = nearest(db, q, { model, limit: N }).at(-1)!.owner
  db.query({
    t: 'update',
    table: TABLE,
    set: { vec: val(pack(queries[3])) },
    where: eq(col('owner'), val(far)),
  })
  for (let settled of [false, true]) {
    if (settled) absorb(db)
    assertEquals(top(db, q)[0], `v-${N + 1}`)
    assertEquals(top(db, queries[3])[0], `v-${far}`)
    assertEquals(top(db, last)[0], `v-${N}`)
    alike(db)
  }
  // what the writes left is the copy a load makes now, code for code
  assertEquals(copy(db), copy({ ...db }))
})

test('a copy whose dirty set another driver cleared loads again', () => {
  let db = corpus()
  let other: Driver = { query: db.query }
  let q = queries[1]
  top(db, q)
  other.query(insert('entity', { id: N + 1, eid: `v-${N + 1}` }))
  other.query(insert(TABLE, { owner: N + 1, model, hash: '', vec: pack(q) }))
  absorb(other)
  assertEquals(top(db, q)[0], `v-${N + 1}`)
  alike(db)
})

test('a buried entity, or one moved to another model, is no neighbour', () => {
  let db = corpus()
  let q = queries[2]
  let [first, second] = top(db, q)
  bury(db, Number(first.slice(2)))
  db.query({
    t: 'update',
    table: TABLE,
    set: { model: val('next') },
    where: eq(col('owner'), val(Number(second.slice(2)))),
  })
  let now = top(db, q)
  assert(!now.includes(first) && !now.includes(second), now.join())
  absorb(db)
  alike(db)
})
