// The overlay: the batch, readable as tables, through the ordinary compiled
// statements. Every read below goes through `read()` — the same door a query
// takes any other day — so what these assert is that a rule needs no second
// evaluator to see a batch that has not landed.

import { assertEquals } from '@std/assert'
import { mem, shop } from './harness.ts'
import { overlay } from './overlay.ts'
import { read } from './read.ts'
import { storage } from './mod.ts'
import type { Bundle } from '@yaks/graph'

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
  try {
    assertEquals(titles(read(driver, shop, '.product!')), ['Dune', 'Valis'])
    // The patch folded into the committed row: the title it never mentioned
    // is still there, and the price it did mention moved.
    assertEquals(titles(read(driver, shop, '.product.price>10')), ['Dune'])
    assertEquals(titles(read(driver, shop, '.doc!')), ['Dune', 'Ubik', 'Valis'])
    // The fresh entity is a first-class row: it joins, it filters, it reads
    // back by its own eid.
    assertEquals(read(driver, shop, '.product.price=7')[0].entity.eid, 'p3')
  } finally {
    over.drop()
  }
  // And nothing of it survives: the committed graph is exactly as it was.
  assertEquals(titles(read(driver, shop, '.product!')), ['Dune', 'Ubik'])
  assertEquals(read(driver, shop, '.product.price>10').length, 0)
})

Deno.test('a deleted entity leaves every membership while the overlay stands', () => {
  let { driver } = shopFloor()
  let over = overlay(driver, shop, [{ entity: { eid: 'p2' }, $delete: true }])
  try {
    assertEquals(titles(read(driver, shop, '.doc!')), ['Dune'])
  } finally {
    over.drop()
  }
  assertEquals(titles(read(driver, shop, '.doc!')), ['Dune', 'Ubik'])
})

Deno.test('a reference to an entity the same batch mints resolves', () => {
  let { driver } = shopFloor()
  let over = overlay(driver, shop, [
    { entity: { eid: 'm1' }, doc: { title: 'Herbert' } },
    { entity: { eid: 'p3' }, product: { maker: 'm1' }, doc: { title: 'Dune' } },
  ])
  try {
    // The join is the point: a rule that reads `product.maker` on a batch's own
    // entity is reading a reference to another entity of the same batch.
    let found = read(driver, shop, '.product.maker=m1')
    assertEquals(found.map((b) => b.entity.eid), ['p3'])
    assertEquals((found[0].product as { maker: string }).maker, 'm1')
  } finally {
    over.drop()
  }
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
    let batch = Array.from({ length: 20 }, (_, i) => ({
      entity: { eid: `n${i}` },
      doc: { title: `fresh${i}` },
      product: { price: 100000 + i },
    }))
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
    let raising = statements
    try {
      assertEquals(read(counted, shop, '.product.price>=100000').length, 20)
    } finally {
      over.drop()
    }
    return raising
  }
  // Three statements per covered component (create, insert, view) plus the
  // spine's three, one committed-row read per component, and one id lookup —
  // ten, whatever is already in the file.
  assertEquals(cost(0), 10)
  assertEquals(cost(2000), 10)
})

Deno.test('an overlay covers what will be read and nothing else', () => {
  let { driver } = shopFloor()
  let over = overlay(driver, shop, [
    { entity: { eid: 'p1' }, doc: { title: 'Moved' }, product: { price: 99 } },
  ], ['product'])
  try {
    assertEquals(over.covers, ['product'])
    // `product` is overlaid, so the batch's price is what a query sees…
    assertEquals(read(driver, shop, '.product.price=99').length, 1)
    // …and `doc` is not, so the committed title is what it still reads. A
    // caller asks for the components its rules name; asking for fewer is not
    // a smaller answer, it is a different world.
    assertEquals(titles(read(driver, shop, '.doc!')), ['Dune', 'Ubik'])
  } finally {
    over.drop()
  }
})

Deno.test('a batch that mints nothing leaves the identity table alone', () => {
  let { driver } = shopFloor()
  let over = overlay(driver, shop, [
    { entity: { eid: 'p1' }, product: { price: 99 } },
  ])
  try {
    assertEquals(over.covers, ['product'])
    assertEquals(read(driver, shop, '.product.price=99').length, 1)
  } finally {
    over.drop()
  }
})
