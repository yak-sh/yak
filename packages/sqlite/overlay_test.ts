// The overlay: the batch, readable as tables, through the ordinary compiled
// statements. Every read below goes through `matched()` — the same door a
// rule takes — so what these assert is that a rule needs no second evaluator
// to see a batch that has not landed.

import { assertEquals } from '@std/assert'
import { match } from '@yaks/graph'
import { mem, shop } from './harness.ts'
import { type Overlay, overlay } from './overlay.ts'
import { matched } from './rules.ts'
import { read } from './read.ts'
import { storage } from './mod.ts'
import type { Driver } from './driver.ts'
import type { Bundle } from '@yaks/graph'

// One query, asked of the graph with the batch standing in it. No anchor: the
// caller is asking the match outright, which is what these tests want to see.
let seen = (driver: Driver, over: Overlay, source: string): string[] =>
  matched(driver, match(source), shop, {}, { at: over.at }, over)
    .map((b) => String(b.entities[0])).sort()

let titles = (rows: Bundle[]): string[] =>
  rows.map((b) => String((b.doc as { title?: string })?.title ?? '')).sort()

// A store with a few committed products, and the driver under it.
let shopFloor = () => {
  let driver = mem()
  let s = storage(driver, shop)
  s.install()
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'p1' }, doc: { title: 'Dune' }, product: { price: 9 } },
      { entity: { eid: 'p2' }, doc: { title: 'Ubik' }, product: { price: 4 } },
    ])
  )
  return { driver, s }
}

Deno.test('a batch reads as rows before it is written', () => {
  let { driver } = shopFloor()
  let over = overlay(driver, shop, [
    // a fresh entity, with no spine of its own yet
    { entity: { eid: 'p3' }, doc: { title: 'Valis' }, product: { price: 7 } },
    // a patch: one column moves, the rest of the row stands
    { entity: { eid: 'p1' }, product: { price: 20 } },
    // a component dropped
    { entity: { eid: 'p2' }, product: null },
  ])
  assertEquals(seen(driver, over, '.product!'), ['p1', 'p3'])
  // The patch folded into the committed row: the title it never mentioned is
  // still there, and the price it did mention moved.
  assertEquals(seen(driver, over, '.product.price>10, .doc.title=Dune'), ['p1'])
  assertEquals(seen(driver, over, '.doc!'), ['p1', 'p2', 'p3'])
  // The fresh entity is a first-class row: it joins, it filters, it reads back
  // by its own eid.
  assertEquals(seen(driver, over, '.product.price=7'), ['p3'])

  // And nothing of it is anywhere but in that statement: the committed graph
  // is exactly as it was, and always was — the overlay is a `with` prefix, so
  // there is nothing to take down.
  assertEquals(titles(read(driver, shop, '.product!')), ['Dune', 'Ubik'])
  assertEquals(read(driver, shop, '.product.price>10').length, 0)
})

Deno.test('a deleted entity leaves every membership while the overlay stands', () => {
  let { driver } = shopFloor()
  let over = overlay(driver, shop, [{ entity: { eid: 'p2' }, $delete: true }])
  assertEquals(seen(driver, over, '.doc!'), ['p1'])
  assertEquals(titles(read(driver, shop, '.doc!')), ['Dune', 'Ubik'])
})

Deno.test('a reference to an entity the same batch mints resolves', () => {
  let { driver } = shopFloor()
  let over = overlay(driver, shop, [
    { entity: { eid: 'm1' }, doc: { title: 'Herbert' } },
    { entity: { eid: 'p3' }, product: { maker: 'm1' }, doc: { title: 'Dune' } },
  ])
  // The join is the point: a rule that reads `product.maker` on a batch's own
  // entity is reading a reference to another entity of the same batch.
  assertEquals(seen(driver, over, '.product.maker=m1'), ['p3'])
})

Deno.test('the overlay costs the batch, never the database', () => {
  // The same batch, raised over a graph of 2 and a graph of 2,002. What it
  // costs must be the same both times — a wall clock would only say how loaded
  // the box is, so what is asserted is the statements, which is the thing that
  // does not scale.
  let cost = (size: number) => {
    let { driver, s } = shopFloor()
    if (size) {
      s.tx((tx) =>
        tx.patch(
          Array.from({ length: size }, (_, i) => ({
            entity: { eid: `x${i}` },
            doc: { title: `t${i}` },
            product: { price: i },
          })),
        )
      )
    }
    let batch: Bundle[] = [
      ...Array.from({ length: 20 }, (_, i) => ({
        entity: { eid: `n${i}` },
        doc: { title: `fresh${i}` },
        product: { price: 100000 + i },
      })),
      // and one patch to a committed row, so the fold has something to read
      { entity: { eid: 'p1' }, product: { price: 100042 } },
    ]
    let statements = 0
    let counted = {
      ...driver,
      query: (sql: string, params: Parameters<typeof driver.query>[1]) => {
        statements++
        return driver.query(sql, params)
      },
      exec: (sql: string) => {
        statements++
        return driver.exec(sql)
      },
    }
    let over = overlay(counted, shop, batch)
    assertEquals(seen(counted, over, '.product.price>=100000').length, 21)
    return statements
  }
  // One id lookup, one committed-row read for the one component a patch
  // folds into, and the read itself. Three, whatever is already in the file:
  // the CTE NAMES the committed table for every row the batch never touched,
  // so nothing is copied and nothing is counted.
  assertEquals(cost(0), 3)
  assertEquals(cost(2000), 3)
})

Deno.test('an overlay covers what will be read and nothing else', () => {
  let { driver } = shopFloor()
  let over = overlay(driver, shop, [
    { entity: { eid: 'p1' }, doc: { title: 'Moved' }, product: { price: 99 } },
  ], ['product'])
  assertEquals(over.covers, ['product'])
  // `product` is overlaid, so the batch's price is what a query sees…
  assertEquals(seen(driver, over, '.product.price=99'), ['p1'])
  // …and `doc` is not, so the committed title is what it still reads. A
  // caller asks for the components its rules name; asking for fewer is not a
  // smaller answer, it is a different world.
  assertEquals(seen(driver, over, '.doc.title=Dune'), ['p1'])
})

Deno.test('a batch that mints nothing leaves the identity table alone', () => {
  let { driver } = shopFloor()
  let over = overlay(driver, shop, [
    { entity: { eid: 'p1' }, product: { price: 99 } },
  ])
  assertEquals(over.covers, ['product'])
  assertEquals(over.with.includes('_over_entity'), false)
  assertEquals(seen(driver, over, '.product.price=99'), ['p1'])
})
