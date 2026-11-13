/// <reference lib="deno.ns" />
// A rule's match answered in memory, as @yaks/sqlite's rules_test answers it
// in one statement.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { match } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    doc: { component: true, properties: { body: { type: 'string' } } },
    review: {
      component: true,
      properties: { product: { type: 'string', ref: 'entity' } },
    },
    product: { component: true, properties: { price: { type: 'number' } } },
  },
})

// A note holding a product's eid as plain text, as an app's string property
// holds a blob's, and a review of that product.
let vars = (src: string) => {
  let s = ram(vocab)
  return s.tx((tx) =>
    tx.bindings!([match(src)], [
      { entity: { eid: 'n1' }, doc: { body: 'p1' } },
      { entity: { eid: 'p1' }, product: { price: 9 } },
      { entity: { eid: 'r1' }, review: { product: 'p1' } },
    ])[0].map((b) => b.vars)
  )
}

test('a path ending in entity.eid binds the eid it reaches as a value', () => {
  assertEquals(
    vars('$n .doc.body=$p; $r .review, review.product.entity.eid=$p'),
    [{ n: 'n1', p: 'p1', r: 'r1' }],
  )
  assertEquals(vars('.product.price>5, entity.eid=$e'), [{ e: 'p1' }])
})

test('an entity variable and a plain value are refused as the same slot', () => {
  let no = assertThrows(
    () => vars('.doc.body=$p; .review, review.product=$p'),
    Error,
    'entity in one place',
  )
  assertEquals(no.name, 'Refused')
})
