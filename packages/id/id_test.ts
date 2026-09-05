// The human id over a small bookstore vocabulary: a book is B, an author is A,
// a review declares nothing and borrows its initial.

import { assert, assertEquals } from '@std/assert'
import { extendMeta, loadVocab, type VocabDoc } from '@yaks/vocab'
import { ID_URI, idKeywords } from './keywords.ts'
import { format, idOf, parse, prefixes, prefixOf } from './id.ts'
import { mint, SHORT, short } from './mint.ts'

let catalog: VocabDoc = {
  $vocabulary: { 'https://yaks.sh/vocab/core': true, [ID_URI]: true },
  $defs: {
    book: {
      type: 'object',
      kind: true,
      prefix: 'B',
      properties: { title: { type: 'string' } },
    },
    author: {
      type: 'object',
      kind: true,
      prefix: 'A',
      properties: { name: { type: 'string' } },
    },
    review: {
      type: 'object',
      kind: true,
      properties: { stars: { type: 'number' } },
    },
  },
}

let v = loadVocab([catalog], [idKeywords])
let id = idOf(v)
let eid = '9f1c8d2a-0b44-4e51-9f77-6a0c1e2d3b45'

Deno.test('the prefix table comes from the vocabulary', () => {
  assertEquals(prefixes(v), { book: 'B', author: 'A' })
  // a component declaring none borrows its initial, so every entity has an id
  assertEquals(prefixOf(v)('review'), 'R')
})

Deno.test('a numbered entity wears its human id', () => {
  assertEquals(id({ eid, kind: 'book', num: 7 }), 'B-7')
  assertEquals(id({ eid, kind: 'author', num: 12 }), 'A-12')
  assertEquals(id({ eid, kind: 'review', num: 3 }), 'R-3')
})

Deno.test('an unnumbered entity wears its short handle', () => {
  assertEquals(id({ eid, kind: 'book' }), '9f1c8d2a')
  assertEquals(id({ eid, kind: 'book', num: null }), '9f1c8d2a')
  assert(SHORT.test(short(eid)))
})

Deno.test('an id parses back, letter optional and case-blind', () => {
  assertEquals(parse('B-7'), { prefix: 'B', num: 7 })
  assertEquals(parse('b-7'), { prefix: 'B', num: 7 })
  assertEquals(parse('7'), { prefix: '', num: 7 })
  assertEquals(format('B', 7), 'B-7')
  assertEquals(parse(format('A', 12)), { prefix: 'A', num: 12 })
})

Deno.test('what is not a human id says so', () => {
  for (let token of [eid, '9f1c8d2a', 'B-', '-7', 'B7', 'gatsby', '']) {
    assertEquals(parse(token), undefined, token)
  }
})

Deno.test('a minted eid is a v4 uuid, and each one is its own', () => {
  let a = mint()
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(a),
    a,
  )
  assert(a != mint())
})

Deno.test('the keyword is registered, so the loader carries it', () => {
  assertEquals(v.comp('book')?.keywords, { prefix: 'B' })
  // without the registration the vocabulary answers nothing about ids
  assertEquals(prefixes(loadVocab([catalog])), {})
  // and the meta-schema admits `prefix` only once composed
  let meta = extendMeta([idKeywords]) as Record<string, Record<string, unknown>>
  let comp = meta.$defs.component as { properties: Record<string, unknown> }
  assertEquals(
    (comp.properties.prefix as { pattern: string }).pattern,
    '^[A-Z]$',
  )
  assertEquals(meta.$vocabulary[ID_URI], true)
})
