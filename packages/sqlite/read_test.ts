// Reads compile a query and gather whole entities: a filter selects, a
// reference reads back as the eid it points at, a bare word searches the text,
// and an aggregate comes back as raw rows.

import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from './bundle.ts'
import { store } from './harness.ts'

let c = (b: Bundle, name: string): Comp => b[name] as Comp
let eids = (bs: Bundle[]): string[] => bs.map((b) => b.entity.eid).sort()

Deno.test('a scalar filter selects the matching entities', () => {
  let s = store()
  s.write([
    { entity: { eid: 'p1' }, product: { price: 10 } },
    { entity: { eid: 'p2' }, product: { price: 20 } },
  ])
  assertEquals(eids(s.read('.price=10')), ['p1'])
  assertEquals(eids(s.read('.price>=15')), ['p2'])
})

Deno.test('a reference reads back as the target eid', () => {
  let s = store()
  s.write([
    { entity: { eid: 'm1' }, doc: { title: 'Acme' } },
    { entity: { eid: 'p1' }, product: { price: 5, maker: 'm1' } },
  ])
  assertEquals(c(s.read('.kind=product')[0], 'product').maker, 'm1')
})

Deno.test('a reference-deref path filters through the target', () => {
  let s = store()
  s.write([
    { entity: { eid: 'm1' }, doc: { title: 'Acme' } },
    { entity: { eid: 'p1' }, product: { price: 5, maker: 'm1' } },
    { entity: { eid: 'm2' }, doc: { title: 'Other' } },
    { entity: { eid: 'p2' }, product: { price: 6, maker: 'm2' } },
  ])
  assertEquals(eids(s.read('.product.maker.doc.title~=acme')), ['p1'])
})

Deno.test('a bare-word query matches document title and body', () => {
  let s = store()
  s.write([
    {
      entity: { eid: 'a' },
      doc: { title: 'Blue mug', body: 'ceramic and glazed' },
    },
    { entity: { eid: 'b' }, doc: { title: 'Red plate', body: 'enamel' } },
  ])
  assertEquals(eids(s.read('mug')), ['a'])
  assertEquals(eids(s.read('ceramic')), ['a'])
  assertEquals(eids(s.read('enamel')), ['b'])
})

Deno.test('the kind scope selects the most specific kind', () => {
  let s = store()
  s.write([
    { entity: { eid: 'p1' }, doc: { title: 'Mug' }, product: { price: 1 } },
    { entity: { eid: 'd1' }, doc: { title: 'About' } },
  ])
  assertEquals(eids(s.read('.kind=product')), ['p1'])
  assertEquals(eids(s.read('.kind=doc')), ['d1'])
})

Deno.test('rows() hands back an aggregate shape verbatim', () => {
  let s = store()
  s.write([
    { entity: { eid: 'p1' }, product: { status: 'live' } },
    { entity: { eid: 'p2' }, product: { status: 'live' } },
    { entity: { eid: 'p3' }, product: { status: 'draft' } },
  ])
  assertEquals(Number(s.rows('.status=live&.count!')[0].n), 2)
})

Deno.test('the newest-first window pages a prefix', () => {
  let s = store()
  s.write([
    { entity: { eid: 'p1' }, product: { price: 1 } },
    { entity: { eid: 'p2' }, product: { price: 2 } },
    { entity: { eid: 'p3' }, product: { price: 3 } },
  ])
  // .limit orders newest (highest num) first — the last written leads.
  assertEquals(
    s.read('.kind=product&.limit=2').map((b) => b.entity.eid),
    ['p3', 'p2'],
  )
})

Deno.test('a gathered bundle carries the entity number storage minted', () => {
  let s = store()
  s.write([
    { entity: { eid: 'p1' }, product: { price: 1 } },
    { entity: { eid: 'p2' }, product: { price: 2 } },
  ])
  assertEquals(s.read('.price=2')[0].entity, { eid: 'p2', num: 2 })
})
