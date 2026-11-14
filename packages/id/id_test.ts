// The human id over a small bookstore vocabulary: a book is B, an author is A,
// a review declares nothing and so is never numbered.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { extendMeta, loadVocab, type VocabDoc } from '@yaks/vocab'
import { ID_URI, idKeywords } from './keywords.ts'
import {
  answering,
  format,
  HUMAN,
  human,
  idOf,
  idsIn,
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
  assertEquals(prefixOf(library)('book'), 'L')
  assertEquals(prefixOf(v)('book'), 'B')
  assertEquals(prefixOf(library)('author'), 'A')
})

test('a numbered entity wears the pair it stores', () => {
  assertEquals(id({ eid, num: 7, prefix: 'B' }), 'B-7')
  assertEquals(id({ eid, num: 12, prefix: 'A' }), 'A-12')
  // the letter is the one stored, whatever the components say now
  assertEquals(
    human(v)({ entity: { eid, num: 3, prefix: 'A' }, book: {} }),
    'A-3',
  )
  assertEquals(seriesOf(v)(['review', 'author']), 'A')
})

test('a number stored without a letter is no id, so it shows the handle', () => {
  assertEquals(human(v)({ entity: { eid, num: 3 }, book: {} }), '#9f1c8d2a0b')
  assertEquals(id({ eid, kind: 'book', num: 3 }), '#9f1c8d2a0b')
})

test('every id a numbered entity wears parses back to its pair', () => {
  for (let prefix of ['B', 'A']) {
    assertEquals(parse(id({ eid, num: 7, prefix })), { prefix, num: 7 })
  }
})

test('an unnumbered entity wears its short handle, with no letter', () => {
  assertEquals(id({ eid }), '#9f1c8d2a0b')
  assertEquals(id({ eid, num: null, prefix: 'A' }), '#9f1c8d2a0b')
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

test("the letter is the kind's, declared on a component or under kinds", () => {
  // read with the kind, whatever keywords the load registered
  assertEquals(prefixes(loadVocab([catalog])), { book: 'B', author: 'A' })
  // a component with a prefix is the kind of its name; a shape names its own
  let shelf = loadVocab([{
    $defs: {
      box: { component: true, prefix: 'X' },
      shelf: { component: true },
    },
    kinds: { stack: { is: ['box', 'shelf'], prefix: 'S' } },
  }])
  assertEquals(prefixes(shelf), { stack: 'S', box: 'X' })
  assertEquals(seriesOf(shelf)(['box', 'shelf']), 'S')
  assertEquals(seriesOf(shelf)(['box']), 'X')
  let meta = extendMeta([idKeywords]) as Record<string, Record<string, unknown>>
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

test('an id names the entity holding its pair', () => {
  let held = [{ e: 'b', prefix: 'B' }, { e: 'old' }, { e: 'a', prefix: 'A' }]
  let named = (prefix: string, among = held) =>
    answering(among, prefix, (h) => h).map((h) => h.e)
  assertEquals(
    [named('B'), named('T'), named(''), named('B', held.slice(2))],
    [['b'], [], ['b', 'old', 'a'], []],
  )
  for (let typed of ['B-7', 'b-7', '7']) {
    assert(names(typed, { num: 7, prefix: 'B' }))
  }
  // a number stored without a letter answers only to the bare number
  assert(names('7', { num: 7 }) && !names('B-7', { num: 7 }))
  assert(!names('A-7', { num: 7, prefix: 'B' }))
  assert(!names('B-7', { num: 8, prefix: 'B' }) && !names('B-0', {}))
})
