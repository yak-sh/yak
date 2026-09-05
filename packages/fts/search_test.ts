// Ranked hits with marked snippets.

import { assert, assertEquals } from '@std/assert'
import { parse } from '@yaks/query'
import { compile } from '@yaks/sql'
import { fields } from './fields.ts'
import { search } from './compile.ts'
import { find, hits } from './search.ts'
import { CLOSE, OPEN } from './term.ts'
import { shelf, shop } from './harness.ts'

let text = fields(shop)

Deno.test('hits come back closest first, one row per entity', () => {
  let found = find(shelf(), text, 'dragon')
  assertEquals(found.length, 3)
  assertEquals(new Set(found.map((h) => h.entity)).size, 3)
  assert(found[0].rank <= found[1].rank)
})

Deno.test('a snippet marks each hit with control characters, never markup', () => {
  let [first] = find(shelf(), text, 'burglar')
  assert(first.snippet.includes(`${OPEN}burglar${CLOSE}`), first.snippet)
  assert(!first.snippet.includes('<'), first.snippet)
})

Deno.test('the snippet comes from whichever property matched', () => {
  let [review] = find(shelf(), text, 'chapters')
  assertEquals(review.entity, 'review-4')
  assert(review.snippet.includes(`${OPEN}chapters${CLOSE}`), review.snippet)
})

Deno.test('a screen narrows the hits to what the filters allow', () => {
  let db = shelf()
  let screen = compile(parse('dragon .price<15'), shop, {
    extend: [search(text)],
  })
  assertEquals(
    find(db, text, 'dragon', { screen }).map((h) => h.entity),
    ['book-1'],
  )
})

Deno.test('the limit bounds the answer', () => {
  assertEquals(find(shelf(), text, 'dragon', { limit: 1 }).length, 1)
})

Deno.test('a deleted entity is not a hit', () => {
  let db = shelf()
  db.query(
    `insert into tombstone (entity, deleted_at) values (1, '2026-01-01')`,
    [],
  )
  assertEquals(
    find(db, text, 'dragon').map((h) => h.entity),
    ['book-2', 'review-4'],
  )
})

Deno.test('a search that cannot be asked finds nothing', () => {
  assertEquals(hits(text, '  '), null)
  assertEquals(hits([], 'dragon'), null)
  assertEquals(find(shelf(), text, ''), [])
})
