/// <reference lib="deno.ns" />
// The defining test: one script of batches, two storages, no disagreement.
//
// The script lives beside the reference adapter (@yaks/sqlite's parity.ts),
// because agreeing with the database is what it means to be a storage adapter.
// Both sides run @yaks/graph's own `apply()` over the same shop vocabulary —
// one storing rows in an in-memory SQLite database, the other storing bundles
// in this package's Map — and must return the same bundles, refuse the same
// batches, and read back the same entities, batch for batch.

import { test } from '@yaks/testing'
import { answers, parity, rig } from '../sqlite/parity.ts'
import { shop, store } from '../sqlite/testing.ts'
import { ram } from './mod.ts'
import { assert, assertEquals } from '@std/assert'
import { parse } from '@yaks/query'

let mine = () => rig(ram(shop, { number: true }))

test('a ram graph and a sqlite graph agree, batch for batch', () => {
  parity(mine(), rig(store()))
})

test('a ram graph selects what each query means', () => answers(mine()))

for (
  let [name, s] of [['RAM', ram(shop, { number: true })], [
    'SQL',
    store(),
  ]] as const
) {
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'first' }, product: { price: 20 } },
      { entity: { eid: 'second' }, product: { price: 10 } },
      { entity: { eid: 'third' }, product: { price: 30 } },
    ])
  )
  let q = parse('.product.price>=20 .limit=1')
  test(`${name}: unordered reads retain filters, limits and separate cached defaults`, () => {
    let any = s.rows(q, { unordered: true })
    assertEquals(any.length, 1)
    assert(['first', 'third'].includes(String(any[0].eid)))
    assertEquals(s.rows(q), [{ eid: 'third' }])
  })
  for (
    let query of [
      '.product .order=product.price .limit=1',
      '.product .after=second .limit=1',
    ]
  ) {
    let q = parse(query)
    let expected = s.rows(q)
    test(`${name}: unordered leaves requested sequences intact: ${query}`, () =>
      assertEquals(s.rows(q, { unordered: true }), expected))
  }
}
