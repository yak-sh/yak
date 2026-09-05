// Admission's three answers: drop, refuse, or let through — one test per rule,
// because which mistakes are loud is the whole design of this phase.

import { assertEquals, assertThrows } from '@std/assert'
import { admit, Refused } from './admit.ts'
import { books } from './harness.ts'

let one = (b: Record<string, unknown>, trusted = false) =>
  admit([b as never], books, trusted)

Deno.test('an unknown component is dropped, the rest of the bundle lands', () => {
  let [out] = one({
    entity: { eid: 'b1' },
    doc: { title: 'Dune' },
    audiobook: { minutes: 400 },
  })
  assertEquals(out.doc, { title: 'Dune' })
  assertEquals(out.audiobook, undefined)
})

Deno.test('a bundle whose every component was unknown leaves the batch', () => {
  assertEquals(one({ entity: { eid: 'b1' }, audiobook: { minutes: 4 } }), [])
})

Deno.test('an unknown column on a known component refuses the batch', () => {
  assertThrows(
    () => one({ entity: { eid: 'b1' }, book: { pagez: 3 } }),
    Refused,
    'book.pagez',
  )
})

Deno.test('a server-owned column is dropped, and admitted when trusted', () => {
  let [out] = one({ entity: { eid: 'b1' }, created: { at: 'now' }, doc: {} })
  assertEquals(out.created, undefined)
  let [ok] = one({ entity: { eid: 'b1' }, created: { at: 'now' } }, true)
  assertEquals(ok.created, { at: 'now' })
})

Deno.test('a bundle of nothing but server-owned columns leaves the batch', () => {
  assertEquals(one({ entity: { eid: 'b1' }, created: { at: 'now' } }), [])
})

Deno.test('a bare touch names an entity and asks for nothing', () => {
  assertEquals(one({ entity: { eid: 'b1' } }), [{ entity: { eid: 'b1' } }])
})

Deno.test('a value the vocabulary cannot hold refuses the batch', () => {
  assertThrows(
    () => one({ entity: { eid: 'b1' }, book: { status: 'shipped' } }),
    Refused,
    'draft, stocked, sold',
  )
  assertThrows(
    () => one({ entity: { eid: 'b1' }, book: { pages: 'many' } }),
    Refused,
    'book.pages is a number',
  )
})

Deno.test('a null component, a null column and a bare tag all pass', () => {
  let [out] = one({
    entity: { eid: 'b1' },
    book: { publisher: null },
    review: null,
    bookmark: {},
  })
  assertEquals(out.book, { publisher: null })
  assertEquals(out.review, null)
  assertEquals(out.bookmark, {})
})

Deno.test('a delete survives even when its components were all dropped', () => {
  let [out] = one({
    entity: { eid: 'b1' },
    $delete: true,
    audiobook: { minutes: 4 },
  })
  assertEquals(out.$delete, true)
})

Deno.test('the reserved keys ride through untouched', () => {
  let was = { doc: { title: 'abc' } }
  let [out] = one({ entity: { eid: 'b1' }, doc: { title: 'x' }, $was: was })
  assertEquals(out.$was, was)
})
