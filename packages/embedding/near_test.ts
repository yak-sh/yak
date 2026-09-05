// The ranking: who is nearest, how far the answer reaches, and what a grave or
// a moved model does to it.

import { assert, assertEquals } from '@std/assert'
import { nearest, vectorOf } from './near.ts'
import { TABLE } from './ddl.ts'
import { embedder, stocked } from './harness.ts'

let model = embedder.model
let names = (db: Awaited<ReturnType<typeof stocked>>, of: string, n = 8) =>
  nearest(db, vectorOf(db, of, model)!, { model, limit: n, without: of })
    .map((h) => h.entity)

Deno.test('the two dragon books are each other, the memoir is not', async () => {
  let db = await stocked()
  let close = names(db, 'book-1')
  assertEquals(close[0], 'book-2')
  assert(close.indexOf('book-3') > close.indexOf('review-4'))
})

Deno.test('nothing is its own neighbour', async () => {
  let db = await stocked()
  assert(!names(db, 'book-1').includes('book-1'))
})

Deno.test('a limit bounds the answer, a floor raises the bar', async () => {
  let db = await stocked()
  assertEquals(names(db, 'book-1', 1).length, 1)
  let q = vectorOf(db, 'book-1', model)!
  assertEquals(nearest(db, q, { model, floor: 0.99 }).map((h) => h.entity), [
    'book-1',
  ])
})

Deno.test('a neighbour carries the integer id its rows key on', async () => {
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

Deno.test('a grave stops being a neighbour before the sweep prunes it', async () => {
  let db = await stocked()
  db.exec(`insert into tombstone values (2, '2026-01-01T00:00:00Z')`)
  assert(!names(db, 'book-1').includes('book-2'))
  // the row is still there — it is the read that refuses it, not the table
  assertEquals(
    Number(db.query(`select count(*) n from "${TABLE}"`, [])[0].n),
    4,
  )
})

Deno.test('another model is another space, and it is empty', async () => {
  let db = await stocked()
  assertEquals(vectorOf(db, 'book-1', 'other'), null)
  assertEquals(nearest(db, new Float32Array(64), { model: 'other' }), [])
})

Deno.test('an entity with no vector has none to anchor on', async () => {
  let db = await stocked()
  assertEquals(vectorOf(db, 'nobody', model), null)
})
