// A phrase searches by meaning and returns a short piece of the text that was
// embedded, even when that text does not contain the phrase.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import {
  among,
  col,
  type Expr,
  fn,
  render,
  select,
  table,
  val,
} from '@yaks/sql'
import { fields } from './fields.ts'
import { excerpt, meaning } from './search.ts'
import { embedder, shop, stocked } from './testing.ts'

test('new words find ranked source excerpts, bounded by the limit', async () => {
  let db = await stocked()
  let hits = await meaning(
    db,
    fields(shop),
    embedder,
    'a burglar leaves home and meets a dragon',
    { limit: 2 },
  )
  assertEquals(hits.length, 2)
  assert(hits.some((h) => h.entity == 'book-1'))
  assert(hits[0].similarity >= hits[1].similarity)
  assert(hits.find((h) => h.entity == 'book-1')!.excerpt.includes(
    'A burglar leaves home',
  ))
  assert(hits.every((h) => !h.excerpt.includes('\x01')))
})

test('a screen narrows meaning search before ranking and limiting', async () => {
  let db = await stocked()
  let screen = render(select({
    cols: [col('id')],
    from: table('entity'),
    where: among(col('eid'), [val('book-3'), val('review-4')]),
  }))
  let hits = await meaning(db, fields(shop), embedder, 'dragon', {
    screen,
    limit: 1,
  })
  assertEquals(hits.map((h) => h.entity), ['review-4'])
})

test('an excerpt reads the configured, resolved source', async () => {
  let db = await stocked()
  let only = fields(shop, (p) => p.prop == 'blurb')
    .map((f) => ({
      ...f,
      text: (stored: Expr) => fn('upper', stored),
    }))
  let screen = render(select({
    cols: [col('id')],
    from: table('entity'),
    where: among(col('eid'), [val('book-1')]),
  }))
  let [hit] = await meaning(db, only, embedder, 'burglar dragon', {
    screen,
    limit: 1,
  })
  assertEquals(hit.entity, 'book-1')
  assert(hit.excerpt.startsWith('A BURGLAR LEAVES HOME'))
  assert(!hit.excerpt.includes('THE HOBBIT'))
})

test('blank words do not ask the embedder', async () => {
  let db = await stocked()
  let no = {
    model: embedder.model,
    embed: (_: string): Float32Array => {
      throw Error('asked to embed blank words')
    },
  }
  assertEquals(await meaning(db, fields(shop), no, '   '), [])
})

test('an excerpt keeps a short, single line from long text', () => {
  let said = excerpt(`  first\n  ${'more words '.repeat(100)}`)
  assert(said.startsWith('first more words'))
  assert(said.endsWith('…'))
  assert(said.length < 200)
  assert(!said.includes('\n'))
})
