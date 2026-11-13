// The human id over a small bookstore vocabulary: a book is B, an author is A,
// a review declares nothing and so is never numbered.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { extendMeta, loadVocab, type VocabDoc } from '@yaks/vocab'
import { ID_URI, idKeywords } from './keywords.ts'
import {
  format,
  HUMAN,
  human,
  idOf,
  idsIn,
  key,
  keys,
  mentions,
  names,
  parse,
  prefixes,
  prefixOf,
  replaceIds,
  seriesOf,
  SHORT,
  short,
} from './id.ts'

let catalog: VocabDoc = {
  $vocabulary: { 'https://yak.sh/vocab/core': true, [ID_URI]: true },
  $defs: {
    book: {
      component: true,
      type: 'object',
      kind: true,
      prefix: 'B',
      properties: { title: { type: 'string' } },
    },
    author: {
      component: true,
      type: 'object',
      kind: true,
      prefix: 'A',
      properties: { name: { type: 'string' } },
    },
    review: {
      component: true,
      type: 'object',
      kind: true,
      properties: { stars: { type: 'number' } },
    },
  },
}

let v = loadVocab([catalog], [idKeywords])
let library = loadVocab([{
  ...catalog,
  $defs: {
    ...catalog.$defs,
    book: {
      component: true,
      type: 'object',
      kind: true,
      prefix: 'L',
      properties: { title: { type: 'string' } },
    },
  },
}], [idKeywords])
let id = idOf(v)
let eid = '9f1c8d2a-0b44-4e51-9f77-6a0c1e2d3b45'

test('the prefix table comes from the vocabulary', () => {
  assertEquals(prefixes(v), { book: 'B', author: 'A' })
  // a component declaring none has no letter
  assertEquals(prefixOf(v)('review'), undefined)
})

test('id prefixes stay with their vocabulary and ignore edits to copied tables', () => {
  let copied = prefixes(v)
  copied.book = 'X'
  let book = { eid, kind: 'book', num: 7 }
  assertEquals(idOf(library)(book), 'L-7')
  assertEquals(idOf(v)(book), 'B-7')
  assertEquals(prefixOf(library)('author'), 'A')
})

test('a numbered entity wears its human id', () => {
  assertEquals(id({ eid, kind: 'book', num: 7 }), 'B-7')
  assertEquals(id({ eid, kind: 'author', num: 12 }), 'A-12')
})

test('a row stored without a prefix prints with the letter its components declare', () => {
  let row = { entity: { eid, num: 3 }, review: {}, book: {} }
  assertEquals(human(v)(row), 'B-3')
  assertEquals(
    human(v)({ entity: { eid, num: 3, prefix: 'A' }, book: {} }),
    'A-3',
  )
  // and one whose components declare none shows its handle
  assertEquals(human(v)({ entity: { eid, num: 3 }, review: {} }), '#9f1c8d2a0b')
  assertEquals(id({ eid, kind: 'review', num: 3 }), '#9f1c8d2a0b')
  assertEquals(seriesOf(v)(['review', 'author']), 'A')
})

test('every id a numbered entity wears parses back to its number', () => {
  for (let kind of ['book', 'author']) {
    assertEquals(parse(id({ eid, kind, num: 7 }))?.num, 7, kind)
  }
})

test('an unnumbered entity wears its short handle, with no letter', () => {
  assertEquals(id({ eid, kind: 'book' }), '#9f1c8d2a0b')
  assertEquals(id({ eid, kind: 'author', num: null }), '#9f1c8d2a0b')
  assert(SHORT.test(short(eid)))
  assert(!SHORT.test('B#9f1c8d2a0b'))
})

test('an id parses back, letter optional and case-blind', () => {
  assertEquals(parse('B-7'), { prefix: 'B', num: 7 })
  assertEquals(parse('b-7'), { prefix: 'B', num: 7 })
  assertEquals(parse('7'), { prefix: '', num: 7 })
  assertEquals(format('B', 7), 'B-7')
  assertEquals(parse(format('A', 12)), { prefix: 'A', num: 12 })
})

test('what is not a human id says so', () => {
  for (let token of [eid, '9f1c8d2a', 'B-', '-7', 'B7', 'gatsby', '']) {
    assertEquals(parse(token), undefined, token)
  }
})

test('the keyword is registered, so the loader carries it', () => {
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

test('ids are found in prose only as words of their own', () => {
  let text = 'T-12 needs M-3, not T-123x, COVID-19, #T-4 or `T-5-6`; (P-7).'
  assertEquals(idsIn(text), ['T-12', 'M-3', 'P-7'])
  assertEquals(
    replaceIds(text, (id) => `[${id}]`).slice(0, 15),
    '[T-12] needs [M',
  )
  assert(mentions('see T-14429.', 'T-14429'))
  assert(!mentions('see T-144294', 'T-14429'))
  assert(HUMAN.test('b-7') && !HUMAN.test('7') && !HUMAN.test('#a3f19c'))
})

test('an id keys by its pair, and names the entity holding it', () => {
  assertEquals(['B-7', 'b-7', '7'].map((id) => key(id)), ['B-7', 'B-7', '7'])
  assertEquals([key({ num: 7, prefix: 'B' }), key({ num: 7 })], ['B-7', '7'])
  assertEquals([keys('b-7'), keys('7')], [['B-7', '7'], ['7']])
  for (let typed of ['B-7', 'b-7', '7']) {
    assert(names(typed, { num: 7, prefix: 'B' }))
    // A row stored without a prefix answers under any letter.
    assert(names(typed, { num: 7 }))
  }
  assert(!names('A-7', { num: 7, prefix: 'B' }))
  assertEquals([key('#a3f19c'), key({ num: null }), key({})], [
    undefined,
    undefined,
    undefined,
  ])
  assert(!names('B-7', { num: 8 }) && !names('B-0', {}))
})
