// Ranked hits with marked snippets.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parse } from '@yaks/query'
import { insert, screen as screenOf } from '@yaks/sql'
import { fields } from './fields.ts'
import { search } from './compile.ts'
import { find, hits } from './search.ts'
import { CLOSE, OPEN } from './term.ts'
import { entity, shelf, shop } from './testing.ts'

let text = fields(shop)

test('hits come back closest first, one row per entity', () => {
  let found = find(shelf(), text, 'dragon')
  assertEquals(found.length, 3)
  assertEquals(new Set(found.map((h) => h.entity)).size, 3)
  assert(found[0].rank <= found[1].rank)
})

test('a snippet marks each hit with control characters, never markup', () => {
  let [first] = find(shelf(), text, 'burglar')
  assert(first.snippet.includes(`${OPEN}burglar${CLOSE}`), first.snippet)
  assert(!first.snippet.includes('<'), first.snippet)
})

test('the snippet comes from whichever property matched', () => {
  let [review] = find(shelf(), text, 'chapters')
  assertEquals(review.entity, 'review-4')
  assert(review.snippet.includes(`${OPEN}chapters${CLOSE}`), review.snippet)
})

test('a screen narrows the hits to what the filters allow', () => {
  let db = shelf()
  let screen = screenOf(parse('dragon .price<15'), shop, {
    extend: [search(text)],
  })
  assertEquals(
    find(db, text, 'dragon', { screen: screen ?? undefined })
      .map((h) => h.entity),
    ['book-1'],
  )
})

test('the limit bounds the answer', () => {
  assertEquals(find(shelf(), text, 'dragon', { limit: 1 }).length, 1)
})

test('a deleted entity is not a hit', () => {
  let db = shelf()
  db.query(insert('tombstone', { entity: 1, deleted_at: '2026-01-01' }))
  assertEquals(
    find(db, text, 'dragon').map((h) => h.entity),
    ['book-2', 'review-4'],
  )
})

test('words are terms, so they need not be adjacent or in order', () => {
  let db = shelf()
  assertEquals(
    find(db, text, 'burglar dragon').map((h) => h.entity),
    ['book-1'],
  )
  // The same words as a phrase say the stronger thing, and find nothing.
  assertEquals(find(db, text, '"burglar dragon"'), [])
  assertEquals(
    find(db, text, '"leaves home"').map((h) => h.entity),
    ['book-1'],
  )
})

test('a word reaches the longer word it starts', () => {
  assertEquals(
    find(shelf(), text, 'burgl').map((h) => h.entity),
    ['book-1'],
  )
})

test('a one-letter word matches exactly unless explicitly starred', () => {
  let db = shelf()
  entity(db, 5, 'book-5')
  db.query(insert('book', {
    entity: 5,
    title: 'Amethyst',
    blurb: 'Azure air',
    price: 5,
  }))
  assert(!find(db, text, 'a').some((h) => h.entity == 'book-5'))
  assert(find(db, text, 'a*').some((h) => h.entity == 'book-5'))
})

test('distinctive words of a search are marked in the snippet', () => {
  let [book] = find(shelf(), text, 'burglar dragon')
  assert(book.snippet.includes(`${OPEN}burglar${CLOSE}`), book.snippet)
  assert(book.snippet.includes(`${OPEN}dragon${CLOSE}`), book.snippet)
})

test('a search that cannot be asked finds nothing', () => {
  assertEquals(hits(text, '  '), null)
  assertEquals(hits([], 'dragon'), null)
  assertEquals(find(shelf(), text, ''), [])
})

test('common words still narrow a search but are not highlighted', () => {
  let db = shelf()
  let [book] = find(db, text, 'a burglar with a dragon')
  // The book has no "with", even though it contains both distinctive words.
  assertEquals(book, undefined)
  let [hit] = find(db, text, 'a burglar and a dragon')
  assert(hit.snippet.includes(`${OPEN}burglar${CLOSE}`), hit.snippet)
  assert(hit.snippet.includes(`${OPEN}dragon${CLOSE}`), hit.snippet)
  assert(!hit.snippet.includes(`${OPEN}a${CLOSE}`), hit.snippet)
  assert(!hit.snippet.includes(`${OPEN}and${CLOSE}`), hit.snippet)
  let [common] = find(db, text, 'a and')
  assert(common.snippet.includes(OPEN), common.snippet)
  let [phrase] = find(db, text, '"a burglar leaves"')
  assert(
    phrase.snippet.includes(`${OPEN}A burglar leaves${CLOSE}`),
    phrase.snippet,
  )
})
