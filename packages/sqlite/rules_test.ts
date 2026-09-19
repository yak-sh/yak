// A rule's match, compiled and run: one statement, however many entities it
// is about, against committed rows and against a batch that has not landed.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { match } from '@yaks/graph'
import { mem, shop } from './harness.ts'
import { storage } from './mod.ts'
import { overlay } from './overlay.ts'
import { matched, statement } from './rules.ts'
import { reads } from '@yaks/graph'

// A shop with a maker, two of their products, and one review.
let floor = () => {
  let driver = mem()
  let s = storage(driver, shop)
  s.install()
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'm1' }, doc: { title: 'Herbert' } },
      {
        entity: { eid: 'p1' },
        doc: { title: 'Dune' },
        product: { price: 9, maker: 'm1' },
      },
      {
        entity: { eid: 'p2' },
        doc: { title: 'Ubik' },
        product: { price: 4, maker: 'm1' },
      },
      { entity: { eid: 'r1' }, review: { stars: 5, product: 'p1' } },
    ])
  )
  return { driver, s }
}

Deno.test('one pattern is the ordinary query it looks like', () => {
  let { driver } = floor()
  let hits = matched(driver, match('.product.price>5'), shop)
  assertEquals(hits.map((h) => h.entities), [['p1']])
})

Deno.test('a gate is a left join that found nothing', () => {
  let { driver, s } = floor()
  // A gate is about the matched entity: `+!shelf` is a product that is not on
  // a shelf. The gate joins `shelf` under a name of its own and requires the
  // owner column to be null.
  let m = match('.product, +!shelf')
  assertEquals(matched(driver, m, shop).map((h) => h.entities[0]).sort(), [
    'p1',
    'p2',
  ])
  assert(statement(m, shop).sql.includes('is null'))
  s.tx((tx) => tx.patch([{ entity: { eid: 'p1' }, shelf: { aisle: 'a' } }]))
  assertEquals(matched(driver, m, shop).map((h) => h.entities[0]), ['p2'])
})

Deno.test('two patterns share a variable, and that is the join', () => {
  let { driver } = floor()
  // The review and the product it is about, in one statement: `$p` is an
  // entity in the first pattern and a reference column in the second, and both
  // are integer spine ids, so the compare is an integer compare.
  let m = match('$p .product; .review, review.product=$p')
  let hits = matched(driver, m, shop)
  assertEquals(hits.map((h) => h.entities), [['p1', 'r1']])
  assertEquals(hits[0].vars, { p: 'p1' })
  // One statement, not one per pattern.
  assertEquals(statement(m, shop).sql.split('select').length - 1 > 0, true)
  assert(!statement(m, shop).sql.includes(';'))
})

Deno.test('a variable can tie two plain columns together', () => {
  let { driver } = floor()
  // Both products were made by the same maker, said as a join rather than as
  // a literal: two `product` rows whose `maker` agrees, one of them Dune.
  let m = match(
    '.doc.title=Dune, product.maker=$m; .doc.title=Ubik, product.maker=$m',
  )
  assertEquals(matched(driver, m, shop).map((h) => h.entities), [['p1', 'p2']])
})

Deno.test('an entity variable and a plain value are not the same slot', () => {
  assertThrows(
    () => statement(match('$x .product; .doc.title=$x'), shop),
    Error,
    'entity in one place',
  )
})

Deno.test('the same statement reads a batch that has not landed', () => {
  let { driver } = floor()
  let m = match('$p .product; .review, review.product=$p')
  let batch = [
    // A review of Ubik, and a price change — neither written yet.
    { entity: { eid: 'r2' }, review: { stars: 3, product: 'p2' } },
    { entity: { eid: 'p1' }, product: { price: 99 } },
  ]
  let over = overlay(driver, shop, batch, reads(m, shop))
  try {
    assertEquals(
      matched(driver, m, shop).map((h) => h.entities).sort(),
      [['p1', 'r1'], ['p2', 'r2']],
    )
  } finally {
    over.drop()
  }
  // And with the batch gone, the same statement answers what is committed.
  assertEquals(matched(driver, m, shop).map((h) => h.entities), [['p1', 'r1']])
})

Deno.test('a gate over a batch sees what the batch will add', () => {
  let { driver } = floor()
  let m = match('.product, +!shelf')
  let over = overlay(
    driver,
    shop,
    [
      { entity: { eid: 'p1' }, shelf: { aisle: 'a' } },
      { entity: { eid: 'p2' }, shelf: { aisle: 'b' } },
    ],
    reads(m, shop),
  )
  try {
    // The batch shelves both, so the rule that fires on "a product not on a
    // shelf" has nothing left to fire on — which is exactly what makes a
    // gated rule fire once and no more.
    assertEquals(matched(driver, m, shop).length, 0)
  } finally {
    over.drop()
  }
})

Deno.test('the components a match reads are what an overlay must cover', () => {
  assertEquals(
    reads(match('$p .product, doc.title=$t; .review, review.product=$p'), shop)
      .sort(),
    ['doc', 'product', 'review'],
  )
})
