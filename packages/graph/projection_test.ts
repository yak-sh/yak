// Which components a read answers with: the ones its query names, or with a
// `.fields` projection the properties it names and the entities they reach.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { ram } from '@yaks/ram'
import { loadVocab, type PropSchema } from '@yaks/vocab'
import type { Bundle } from './bundle.ts'
import { graph } from './graph.ts'
import { named } from './projection.ts'
import { books } from './testing.ts'

let comp = (properties: Record<string, PropSchema> = {}) => ({
  component: true,
  type: 'object',
  properties,
})

// `module` is a component, and a property of `symbol` too.
let vocab = loadVocab([{
  $defs: {
    file: comp({ path: { type: 'string' } }),
    module: comp({ blob: { type: 'string' } }),
    symbol: comp({ module: { type: 'string' } }),
    doc: comp({ title: { type: 'string' } }),
  },
}])

let asks = (query: string) => [...named(vocab, query) ?? ['*']].sort()

test('a read answers the components its query names', () => {
  for (
    let [query, comps] of [
      ['.file', ['file']],
      ['.file&?doc', ['doc', 'file']],
      ['.file&?module', ['file', 'module']],
      ['.module&.symbol.module=m1', ['module', 'symbol']],
      ['.file&!doc', ['file']],
      ['id=f1', ['*']],
      // a projection carries the components its paths start from
      ['.file&.fields=doc.title', ['doc']],
      ['id=f1&.fields=entity.eid', []],
    ] as const
  ) assertEquals(asks(query), [...comps], query)
})

// A shelf: a publisher, two books, a review of each.
let shelf = () => {
  let g = graph({ storage: ram(books), vocab: books })
  g.apply([
    { entity: { eid: 'p1' }, doc: { title: 'Ace' } },
    {
      entity: { eid: 'b1' },
      doc: { title: 'Dune', body: 'sand' },
      book: { pages: 412, publisher: 'p1' },
    },
    { entity: { eid: 'b2' }, doc: { title: 'Emma' }, book: { pages: 300 } },
    { entity: { eid: 'r1' }, review: { stars: 5, book: 'b1' } },
    { entity: { eid: 'r2' }, review: { stars: 2, book: 'b2' } },
  ])
  return g
}
let at = (eid: string, comps: Record<string, unknown> = {}) => ({
  entity: { eid },
  ...comps,
})

test('a projection answers what it names, and what its paths reach', () => {
  let g = shelf()
  let reviews = '.review&.order=-review.stars&.fields='
  let cases: [string, Bundle[]][] = [
    // each selected entity narrowed to the properties named
    ['review.stars', [
      at('r1', { review: { stars: 5 } }),
      at('r2', { review: { stars: 2 } }),
    ]],
    // through a reference: the reference itself, and a bundle of its own
    // for what it reaches, carrying what was read off it
    ['review.stars,review.book.doc.title', [
      at('r1', { review: { stars: 5, book: 'b1' } }),
      at('r2', { review: { stars: 2, book: 'b2' } }),
      at('b1', { doc: { title: 'Dune' } }),
      at('b2', { doc: { title: 'Emma' } }),
    ]],
    // two hops, where one book names no publisher
    ['review.book.book.publisher.doc.title', [
      at('r1', { review: { book: 'b1' } }),
      at('r2', { review: { book: 'b2' } }),
      at('b1', { book: { publisher: 'p1' } }),
      at('p1', { doc: { title: 'Ace' } }),
      at('b2'),
    ]],
  ]
  for (let [fields, answer] of cases) {
    assertEquals(g.read(reviews + fields), answer, fields)
  }
})

test('an entity both selected and reached is answered once', () => {
  let docs = '.doc&.order=doc.title&.fields=doc.title,book.publisher.doc.title'
  assertEquals(shelf().read(docs), [
    at('p1', { doc: { title: 'Ace' } }),
    at('b1', { doc: { title: 'Dune' }, book: { publisher: 'p1' } }),
    at('b2', { doc: { title: 'Emma' } }),
  ])
})
