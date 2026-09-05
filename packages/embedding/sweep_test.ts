// The sweep: what it embeds, what it skips, and what it drops.

import { assert, assertEquals } from '@std/assert'
import { fields } from './fields.ts'
import { prune, sources, stale, sweep } from './sweep.ts'
import { vectorOf } from './near.ts'
import { TABLE } from './ddl.ts'
import { embedder, shelf, shop } from './harness.ts'

let text = fields(shop)
let count = (db: ReturnType<typeof shelf>) =>
  Number(db.query(`select count(*) as n from "${TABLE}"`, [])[0].n)

Deno.test('an entity gets one text, joined from every field it wears', () => {
  let one = sources(shelf(), text).find((s) => s.entity == 'book-1')!
  assertEquals(
    one.text,
    'The Hobbit\nA burglar leaves home and meets a dragon.',
  )
  assertEquals(one.had, null)
})

Deno.test('a review is its own entity, not part of the book it is about', () => {
  let all = sources(shelf(), text)
  assertEquals(all.length, 4)
  assert(all.find((s) => s.entity == 'review-4')!.text.includes('chapters'))
})

Deno.test('the sweep embeds everything owed, then nothing', async () => {
  let db = shelf()
  assertEquals(stale(db, text, embedder.model).length, 4)
  assertEquals(await sweep(db, text, embedder), { fresh: 4, left: 0 })
  assertEquals(stale(db, text, embedder.model).length, 0)
  assertEquals(await sweep(db, text, embedder), { fresh: 0, left: 0 })
  assert(vectorOf(db, 'book-1', embedder.model))
})

Deno.test('a limit takes a slice and says what is left', async () => {
  let db = shelf()
  assertEquals(await sweep(db, text, embedder, 3), { fresh: 3, left: 1 })
  assertEquals(await sweep(db, text, embedder), { fresh: 1, left: 0 })
})

Deno.test('edited text is re-embedded, untouched text is not', async () => {
  let db = shelf()
  await sweep(db, text, embedder)
  db.query(`update book set blurb = ? where entity = 1`, ['A cook, actually.'])
  assertEquals(stale(db, text, embedder.model).map((s) => s.entity), ['book-1'])
  assertEquals(await sweep(db, text, embedder), { fresh: 1, left: 0 })
})

Deno.test('a model change invalidates the whole corpus', async () => {
  let db = shelf()
  await sweep(db, text, embedder)
  assertEquals(stale(db, text, 'some-other-model').length, 4)
})

Deno.test('emptied, tombstoned and undressed entities lose their vectors', async () => {
  let db = shelf()
  await sweep(db, text, embedder)
  assertEquals(count(db), 4)
  db.query(`update book set title = ?, blurb = ? where entity = 3`, ['', '  '])
  db.exec(`insert into tombstone values (2, '2026-01-01T00:00:00Z')`)
  db.exec(`delete from review where entity = 4`)
  prune(db, text)
  assertEquals(count(db), 1)
  assert(vectorOf(db, 'book-1', embedder.model))
})

Deno.test('a vocabulary with nothing to embed sweeps to nothing', async () => {
  let db = shelf()
  assertEquals(await sweep(db, [], embedder), { fresh: 0, left: 0 })
  assertEquals(count(db), 0)
})
