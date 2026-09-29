// The quantized index answers what reading every vector answers: across a
// screen, across writes since its build, and on another connection.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import {
  among,
  col,
  type Driver,
  each,
  gt,
  insert,
  render,
  select,
  table,
  val,
} from '@yaks/sql'
import { open } from '@yaks/sqlite/db'
import { bury, entity, SPINE, TOMBSTONE } from '../sqlite/testing.ts'
import { schema, TABLE } from './ddl.ts'
import { build, FEW, install, REBUILD, state } from './native.ts'
import { nearest, type NearOpts } from './near.ts'
import { pack, unit } from './vector.ts'

let model = 'clusters'

// A repeatable stream of numbers in [0, 1).
let random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// `n` vectors around 40 centres, as embeddings of related texts sit, each
// stored beside an entity `v-<id>`.
let DIM = 64
let point = (next: () => number, centre: Float32Array) =>
  unit(centre.map((x) => x + (next() - 0.5) * 0.6))
let corpus = (db: Driver, n: number, from = 1) => {
  let next = random(7)
  let centres = Array.from(
    { length: 40 },
    () => Float32Array.from({ length: DIM }, () => next() - 0.5),
  )
  return store(
    db,
    from,
    Array.from({ length: n }, (_, i) => point(next, centres[(from + i) % 40])),
  )
}
let put = (db: Driver, id: number, vec: Float32Array) =>
  db.query(insert(TABLE, { entity: id, model, hash: '', vec: pack(vec) }))
// Entities `v-<id>` numbered on from `from`, each with its vector, a few
// hundred rows to a statement.
let store = (db: Driver, from: number, vecs: Float32Array[]) => {
  db.query({ t: 'begin' })
  for (let i = 0; i < vecs.length; i += 500) {
    let ids = vecs.slice(i, i + 500).map((_, j) => from + i + j)
    db.query(insert('entity', ...ids.map((id) => ({ id, eid: `v-${id}` }))))
    db.query(insert(
      TABLE,
      ...ids.map((id) => ({
        entity: id,
        model,
        hash: '',
        vec: pack(vecs[id - from]),
      })),
    ))
  }
  db.query({ t: 'commit' })
  return db
}

let fresh = (path = ':memory:') => {
  let db = open(path)
  for (let s of [SPINE, TOMBSTONE, ...schema()]) db.query(s)
  return db
}

// The same database without the extension: every vector read.
let plain = (db: Driver): Driver => ({ query: (s) => db.query(s) })

let anchor = (db: Driver, id: number) =>
  new Float32Array(
    (db.query(select({
      cols: [col('vec')],
      from: table(TABLE),
      where: among(col('entity'), [val(id)]),
    }))[0].vec as Uint8Array).slice().buffer,
  )

let names = (db: Driver, q: Float32Array, opts: Partial<NearOpts> = {}) =>
  nearest(db, q, { model, limit: 8, ...opts }).map((n) => n.entity)

let indexed = (n: number) => {
  let db = corpus(fresh(), n)
  install(db)
  assert(build(db))
  return db
}

test('the index answers what reading every vector answers', () => {
  let db = indexed(600)
  for (let id of [1, 17, 404, 599]) {
    let q = anchor(db, id)
    assertEquals(names(db, q), names(plain(db), q))
    assertEquals(
      names(db, q, { limit: 21 }),
      names(plain(db), q, { limit: 21 }),
    )
  }
  // and it got there reading a fraction of the vectors
  let read = 0
  let counted: Driver = {
    ...db,
    query: (s) => {
      let rows = db.query(s)
      read += rows.filter((r) => r.vec).length
      return rows
    },
  }
  names(counted, anchor(db, 1))
  assert(read < 600 / 2, `${read}`)
})

test('a screen narrows before the nearest are cut, however thin', () => {
  let db = indexed(600)
  // One in a hundred, from every centre: most of the nearest are not it.
  let within = render(select({
    cols: [col('id')],
    from: table('entity'),
    where: among(col('id'), each([3, 103, 203, 303, 403, 503])),
  }))
  let q = anchor(db, 42)
  let got = names(db, q, { within, limit: 3 })
  assertEquals(got, names(plain(db), q, { within, limit: 3 }))
  assert(got.every((e) => Number(e.slice(2)) % 100 == 3))
})

test('a screen admitting many, all of them far, reads further', () => {
  // More codes lie nearer the query than a first scan reads, and the screen
  // admits none of them, only the many on the far side.
  let db = fresh()
  let next = random(3)
  let here = Float32Array.from({ length: DIM }, () => next() - 0.5)
  let there = here.map((x) => -x)
  let near = 5000
  store(
    db,
    1,
    Array.from(
      { length: near + FEW + 100 },
      (_, i) => point(next, i < near ? here : there),
    ),
  )
  install(db)
  assert(build(db))
  let within = render(select({
    cols: [col('id')],
    from: table('entity'),
    where: gt(col('id'), val(near)),
  }))
  let q = anchor(db, 1)
  let got = names(db, q, { within, limit: 3 })
  assertEquals(got, names(plain(db), q, { within, limit: 3 }))
  assert(got.every((e) => Number(e.slice(2)) > near))
})

test('a vector written after the build is near at once; a gone one is not', () => {
  let db = indexed(600)
  let q = anchor(db, 5)
  let [first, second] = names(db, q, { without: 'v-5' })
  entity(db, 9001, 'v-9001')
  put(db, 9001, q)
  db.query({
    t: 'delete',
    from: TABLE,
    where: among(col('entity'), [val(Number(first.slice(2)))]),
  })
  bury(db, Number(second.slice(2)))
  let got = names(db, q, { without: 'v-5' })
  assertEquals(got[0], 'v-9001')
  assert(!got.includes(first) && !got.includes(second))
  assertEquals(got, names(plain(db), q, { without: 'v-5' }))
})

test('a build is made once, and again when enough vectors changed', () => {
  let db = indexed(500)
  assert(!build(db))
  corpus(db, REBUILD, 1000)
  assertEquals(state(db).dirty, REBUILD)
  assert(build(db))
  assertEquals([state(db).dirty, state(db).build.n], [0, 2])
})

test('another connection loads the newer build', () => {
  let dir = Deno.makeTempDirSync()
  try {
    let writer = fresh(`${dir}/g.db`)
    corpus(writer, 500)
    install(writer)
    build(writer)
    let reader = open(`${dir}/g.db`)
    let q = anchor(reader, 3)
    assertEquals(names(reader, q), names(plain(reader), q))
    // A build later the new vectors are no longer dirty, so only the codes
    // the reader loads again know them.
    corpus(writer, REBUILD, 1000)
    entity(writer, 999, 'v-999')
    put(writer, 999, q)
    assert(build(writer))
    assertEquals(names(reader, q, { without: 'v-3' })[0], 'v-999')
    assertEquals(names(reader, q), names(plain(reader), q))
    reader.close()
    writer.close()
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('a database it was never installed on reads every vector', () => {
  let db = corpus(fresh(), 300)
  assert(!build(db))
  let q = anchor(db, 9)
  assertEquals(names(db, q), names(plain(db), q))
})
