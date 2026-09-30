// The ranking: who is nearest, how far the answer reaches, and what a grave or
// a moved model does to it.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import {
  among,
  col,
  insert,
  render,
  select,
  table,
  tally,
  val,
} from '@yaks/sql'
import { bury } from '../sqlite/testing.ts'
import { nearest, vectorOf } from './near.ts'
import { TABLE } from './ddl.ts'
import { pack, unit } from './vector.ts'
import { embedder, shelf, stocked } from './testing.ts'

let model = embedder.model
let names = (db: Awaited<ReturnType<typeof stocked>>, of: string, n = 8) =>
  nearest(db, vectorOf(db, of, model)!, { model, limit: n, without: of })
    .map((h) => h.entity)

test('the two dragon books are each other, the memoir is not', async () => {
  let db = await stocked()
  let close = names(db, 'book-1')
  assertEquals(close[0], 'book-2')
  assert(close.indexOf('book-3') > close.indexOf('review-4'))
})

test('nothing is its own neighbour', async () => {
  let db = await stocked()
  assert(!names(db, 'book-1').includes('book-1'))
})

test('a limit bounds the answer, a floor raises the bar', async () => {
  let db = await stocked()
  assertEquals(names(db, 'book-1', 1).length, 1)
  let q = vectorOf(db, 'book-1', model)!
  assertEquals(nearest(db, q, { model, floor: 0.99 }).map((h) => h.entity), [
    'book-1',
  ])
})

test('a neighbour carries the integer id its rows key on', async () => {
  let db = await stocked()
  let [first] = nearest(db, vectorOf(db, 'book-1', model)!, {
    model,
    without: 'book-1',
    limit: 1,
  })
  assertEquals(first.entity, 'book-2')
  assertEquals(first.owner, 2)
  assert(first.similarity > 0.8 && first.similarity < 1)
})

test('a grave stops being a neighbour before the sweep prunes it', async () => {
  let db = await stocked()
  bury(db, 2)
  assert(!names(db, 'book-1').includes('book-2'))
  // the row is still there — it is the read that refuses it, not the table
  assertEquals(tally(db, TABLE), 4)
})

test('a screen decides what "nearest" is nearest among', async () => {
  let db = await stocked()
  let q = vectorOf(db, 'book-1', model)!
  let within = render(select({
    cols: [col('id')],
    from: table('entity'),
    where: among(col('eid'), [val('book-3'), val('review-4')]),
  }))
  assertEquals(
    nearest(db, q, { model, limit: 1, without: 'book-1', within })
      .map((h) => h.entity),
    ['review-4'],
  )
})

test('another model is another space, and it is empty', async () => {
  let db = await stocked()
  assertEquals(vectorOf(db, 'book-1', 'other'), null)
  assertEquals(nearest(db, new Float32Array(64), { model: 'other' }), [])
})

test('an entity with no vector has none to anchor on', async () => {
  let db = await stocked()
  assertEquals(vectorOf(db, 'nobody', model), null)
})

test('a bounded scan keeps the nearest across more than one screen', () => {
  let db = shelf()
  let model = 'rank-test'
  // Ties straddle the heap boundary; an earlier row wins just as in a stable
  // descending sort. The remaining rows exercise replacement of its root.
  for (let id = 10; id < 50; id++) {
    db.query(insert('entity', { id, eid: `rank-${id}` }))
    let vec = unit(
      new Float32Array([
        1,
        id == 10 || id == 11 ? 0 : id == 13 ? 0.3 : id == 14 ? 0.5 : id,
      ]),
    )
    db.query(insert(TABLE, { owner: id, model, hash: 'test', vec: pack(vec) }))
  }
  let query = new Float32Array([1, 0])
  let got = nearest(db, query, { model, limit: 3 })
  assertEquals(got.map((n) => n.entity), ['rank-10', 'rank-11', 'rank-13'])
  assertEquals(got.map((n) => n.owner), [10, 11, 13])
  assertEquals(
    nearest(db, query, { model, limit: 3, floor: 0.99 })
      .map((n) => n.entity),
    ['rank-10', 'rank-11'],
  )
  assertEquals(
    nearest(db, query, { model, limit: 3, without: 'rank-10' }).map((n) =>
      n.entity
    ),
    ['rank-11', 'rank-13', 'rank-14'],
  )
  assertEquals(nearest(db, query, { model, limit: 0 }), [])
})

test('an unaligned blob still ranks and returns its neighbour', () => {
  let db = shelf()
  db.query(insert('entity', { id: 10, eid: 'rank-10' }))
  db.query(insert(TABLE, {
    owner: 10,
    model: 'rank-test',
    hash: 'test',
    vec: pack(new Float32Array([1, 0])),
  }))
  let unaligned = {
    ...db,
    query: (stmt: Parameters<typeof db.query>[0]) =>
      db.query(stmt).map((row) => {
        if (!(row.vec instanceof Uint8Array)) return row
        let bytes = new Uint8Array(row.vec.length + 1)
        bytes.set(row.vec, 1)
        return { ...row, vec: bytes.subarray(1) }
      }),
  }
  assertEquals(
    nearest(unaligned, new Float32Array([1, 0]), {
      model: 'rank-test',
    }).map((n) => n.entity),
    ['rank-10'],
  )
})
