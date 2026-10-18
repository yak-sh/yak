// Native scans answer exact cosine through filters and concurrent writes.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import {
  among,
  col,
  each,
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
import { bury, entity, SPINE, TOMBSTONE } from '../sqlite/testing.ts'
import { schema, TABLE } from './ddl.ts'
import { FEW, install, prepare } from './native.ts'
import { nearest, type NearOpts } from './near.ts'
import { pack, unit } from './vector.ts'

// Scenarios perform their reads and writes while fixtures load; a failed
// assertion is kept for the runner to report with the case that produced it.
let scene = async (run: () => void | Promise<void>) => {
  try {
    await run()
    return () => {}
  } catch (error) {
    return () => {
      throw error
    }
  }
}

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
let corpus = (db: Statements, n: number, from = 1) => {
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
let put = (db: Statements, id: number, vec: Float32Array) =>
  db.query(insert(TABLE, { owner: id, model, hash: '', vec: pack(vec) }))
// Entities `v-<id>` numbered on from `from`, each with its vector, a few
// hundred rows to a statement.
let store = (db: Statements, from: number, vecs: Float32Array[]) => {
  db.atomic(() => {
    for (let i = 0; i < vecs.length; i += 500) {
      let ids = vecs.slice(i, i + 500).map((_, j) => from + i + j)
      db.query(insert('entity', ...ids.map((id) => ({ id, eid: `v-${id}` }))))
      db.query(insert(
        TABLE,
        ...ids.map((id) => ({
          owner: id,
          model,
          hash: '',
          vec: pack(vecs[id - from]),
        })),
      ))
    }
  })
  return db
}

let fresh = (path = ':memory:') => {
  let db = statements(open(path))
  for (let s of [SPINE, TOMBSTONE, ...schema()]) db.query(s)
  return db
}

// The same database without the extension: every vector read.
let plain = (db: Statements): Statements => ({
  ...db,
  ownership: 'shared',
  facilities: undefined,
})

let anchor = (db: Statements, id: number) =>
  new Float32Array(
    (db.query(select({
      cols: [col('vec')],
      from: table(TABLE),
      where: among(col('owner'), [val(id)]),
    }))[0].vec as Uint8Array).slice().buffer,
  )

let names = (db: Statements, q: Float32Array, opts: Partial<NearOpts> = {}) =>
  nearest(db, q, { model, limit: 8, ...opts }).map((n) => n.entity)

let native = (n: number) => {
  let db = corpus(fresh(), n)
  install(db)
  assert(prepare(db))
  return db
}

test(
  'the native scan answers what reading every vector answers',
  await scene(() => {
    let db = native(600)
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
    let counted: Statements = {
      ...db,
      query: (s) => {
        let rows = db.query(s)
        read += rows.filter((r) => r.vec).length
        return rows
      },
    }
    names(counted, anchor(db, 1))
    assert(read < 600 / 2, `${read}`)
  }),
)

test(
  'a screen narrows before the nearest are cut, however thin',
  await scene(() => {
    let db = native(600)
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
  }),
)

test(
  'a broad screen filters before selecting the nearest vectors',
  await scene(() => {
    // More codes lie nearer the query than a first scan reads (4096), and the
    // screen admits none of them, only the many on the far side: more than FEW
    // entities, so the index is asked, a few hundred of them with a vector.
    let db = fresh()
    let next = random(3)
    let here = Float32Array.from({ length: DIM }, () => next() - 0.5)
    let there = here.map((x) => -x)
    let near = 4200
    let far = 300
    store(
      db,
      1,
      Array.from(
        { length: near + far },
        (_, i) => point(next, i < near ? here : there),
      ),
    )
    // and the rest of the screen, entities with no vector at all
    let rest = Array.from(
      { length: FEW + 100 - far },
      (_, i) => near + far + 1 + i,
    )
    db.atomic(() => {
      for (let i = 0; i < rest.length; i += 500) {
        let ids = rest.slice(i, i + 500)
        db.query(insert('entity', ...ids.map((id) => ({ id, eid: `v-${id}` }))))
      }
    })
    install(db)
    assert(prepare(db))
    let within = render(select({
      cols: [col('id')],
      from: table('entity'),
      where: gt(col('id'), val(near)),
    }))
    let q = anchor(db, 1)
    // Every one admitted points away from the query: no floor, or none is near.
    let opts = { within, limit: 3, floor: -1 }
    let got = names(db, q, opts)
    assertEquals(got.length, 3)
    assertEquals(got, names(plain(db), q, opts))
    assert(got.every((e) => Number(e.slice(2)) > near))
  }),
)

test(
  'a new vector is near at once; a gone one is not',
  await scene(() => {
    let db = native(600)
    let q = anchor(db, 5)
    let [first, second] = names(db, q, { without: 'v-5' })
    entity(db, 9001, 'v-9001')
    put(db, 9001, q)
    db.query({
      t: 'delete',
      from: TABLE,
      where: among(col('owner'), [val(Number(first.slice(2)))]),
    })
    bury(db, Number(second.slice(2)))
    let got = names(db, q, { without: 'v-5' })
    assertEquals(got[0], 'v-9001')
    assert(!got.includes(first) && !got.includes(second))
    assertEquals(got, names(plain(db), q, { without: 'v-5' }))
  }),
)

test(
  'another connection sees new vectors without a rebuild',
  await scene(() => {
    let dir = Deno.makeTempDirSync()
    try {
      let writerDriver = open(`${dir}/g.db`)
      let writer = statements(writerDriver)
      for (let s of [SPINE, TOMBSTONE, ...schema()]) writer.query(s)
      corpus(writer, 500)
      install(writer)
      prepare(writer)
      let readerDriver = open(`${dir}/g.db`)
      let reader = statements(readerDriver)
      let q = anchor(reader, 3)
      assertEquals(names(reader, q), names(plain(reader), q))
      // The reader observes another writer without any index maintenance.
      corpus(writer, 1024, 1000)
      entity(writer, 999, 'v-999')
      put(writer, 999, q)
      assertEquals(names(reader, q, { without: 'v-3' })[0], 'v-999')
      assertEquals(names(reader, q), names(plain(reader), q))
      readerDriver.close()
      writerDriver.close()
    } finally {
      Deno.removeSync(dir, { recursive: true })
    }
  }),
)

test(
  'a database it was never installed on reads every vector',
  await scene(() => {
    let db = corpus(fresh(), 300)
    assertThrows(
      () => install(plain(db)),
      Error,
      'sqlite-vector extension is unavailable',
    )
    assert(!prepare(db))
    let q = anchor(db, 9)
    assertEquals(names(db, q), names(plain(db), q))
  }),
)
