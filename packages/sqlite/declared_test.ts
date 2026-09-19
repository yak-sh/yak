// Declared rules, end to end: a query in, patches in the batch out, over a
// real store. What the rule says is all there is — no code runs for any of
// these.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { graph } from '@yaks/graph'
import type { Bundle } from '@yaks/graph'
import { mem, shop } from './harness.ts'
import { storage } from './mod.ts'

let at = (out: Bundle[], eid: string, name: string) =>
  out.find((b) => b.entity.eid == eid)?.[name] as
    | Record<string, unknown>
    | undefined

let g = (declared: { name: string; match: string; before?: string[] }[]) => {
  let s = storage(mem(), shop)
  s.install()
  return graph({
    storage: s,
    vocab: shop,
    plugins: [{ name: 'shop-rules', declared }],
  })
}

Deno.test('a gated rule fires once and writes what it said', () => {
  // Every product that is not on a shelf goes in aisle Z. The gate is what
  // makes it fire once: after it writes, the product HAS a shelf.
  let one = g([{
    name: 'unshelved',
    match: '.product, +!shelf, +shelf.aisle=Z',
  }])
  let out = one.apply([
    { entity: { eid: 'p1' }, doc: { title: 'Dune' }, product: { price: 9 } },
  ]) as Bundle[]
  assertEquals(at(out, 'p1', 'shelf'), { aisle: 'Z' })
  // And a second batch that touches the product again does not shelve it
  // twice: the gate reads the committed row.
  let again = one.apply([{
    entity: { eid: 'p1' },
    product: { price: 10 },
  }]) as Bundle[]
  assertEquals(at(again, 'p1', 'shelf'), undefined)
})

Deno.test('a rule fires on an entity the same batch created', () => {
  let one = g([{
    name: 'unshelved',
    match: '.product, +!shelf, +shelf.aisle=Z',
  }])
  let out = one.apply([
    { entity: { eid: 'p1' }, product: { price: 9 } },
    { entity: { eid: 'p2' }, product: { price: 4 } },
  ]) as Bundle[]
  assertEquals(at(out, 'p1', 'shelf'), { aisle: 'Z' })
  assertEquals(at(out, 'p2', 'shelf'), { aisle: 'Z' })
})

Deno.test('a rule MAKES an entity, named from its firing', () => {
  // A product with no review gets one, five stars, pointing back at it. The
  // second pattern matches nothing: every word in it writes, so it makes the
  // entity it writes to.
  let one = g([{
    name: 'kind-word',
    match: '$p .product, reviews=; +review.product=$p, +review.stars=5',
  }])
  let out = one.apply([{
    entity: { eid: 'p1' },
    product: { price: 9 },
  }]) as Bundle[]
  let made = out.find((b) => b.review)
  assert(made, 'a review was made')
  assertEquals(made.review, { product: 'p1', stars: 5 })
  // Named from the rule and what it bound, so the same rule on the same
  // binding never makes a second one — and the reverse gate holds anyway.
  let again = one.apply([{
    entity: { eid: 'p1' },
    product: { price: 10 },
  }]) as Bundle[]
  assert(!again.find((b) => b.review), 'no second review')
})

Deno.test('a rule fires on what another rule wrote, in one batch', () => {
  // Shelving is one rule; pricing a shelved product is another. The second
  // fires on the first's output because the batch settles to a fixpoint.
  let one = g([
    { name: 'shelve', match: '.product, +!shelf, +shelf.aisle=Z' },
    {
      name: 'sticker',
      match: '.shelf.aisle=Z, product.status=, *product.status=live',
    },
  ])
  let out = one.apply([{
    entity: { eid: 'p1' },
    product: { price: 9 },
  }]) as Bundle[]
  assertEquals(at(out, 'p1', 'shelf'), { aisle: 'Z' })
  assertEquals((at(out, 'p1', 'product') as { status: string }).status, 'live')
})

Deno.test('a rule that does not gate itself is refused by name and binding', () => {
  // No gate: the rule matches its own output forever. The second firing on the
  // same binding is a refusal, not a loop.
  let one = g([{ name: 'runaway', match: '.product, +shelf.aisle=Z' }])
  assertThrows(
    () => one.apply([{ entity: { eid: 'p1' }, product: { price: 9 } }]),
    Error,
    'runaway fired twice',
  )
  // And nothing landed: a refusal rolls the batch back.
  assertEquals(one.storage.tx((tx) => tx.get(['p1'])), [])
})

Deno.test('a rule writes a resource it named', () => {
  let one = g([{
    name: 'dated',
    match: '.product, +!shelf, +shelf.aisle=#Now',
  }])
  let out = one.apply([{ entity: { eid: 'p1' }, product: { price: 9 } }], {
    now: '2026-09-19T00:00:00.000Z',
  }) as Bundle[]
  assertEquals(at(out, 'p1', 'shelf'), { aisle: '2026-09-19T00:00:00.000Z' })
})

Deno.test('what a rule writes is stamped and journaled like anything else', () => {
  let one = g([{
    name: 'unshelved',
    match: '.product, +!shelf, +shelf.aisle=Z',
  }])
  let out = one.apply([{
    entity: { eid: 'p1' },
    product: { price: 9 },
  }]) as Bundle[]
  // The stamp phase runs after the rules phase, so a rule's own patch is a
  // touch like any other.
  assert(at(out, 'p1', 'created'), 'the entity was stamped')
  let [held] = one.storage.tx((tx) => tx.get(['p1'])) as Bundle[]
  assertEquals(held.shelf, { aisle: 'Z', slot: null, height: null })
})
