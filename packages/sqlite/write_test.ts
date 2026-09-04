// Writes patch: a bundle names only what changes. These pin the four rules —
// omitted columns untouched, a null column cleared, a null component dropped,
// a null entity deleted — and the death each reference word spreads.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from './bundle.ts'
import { store } from './harness.ts'

let c = (b: Bundle, name: string): Comp => b[name] as Comp

Deno.test('a bundle creates an entity wearing its components', () => {
  let s = store()
  s.write([{
    eid: 'p1',
    doc: { title: 'Mug' },
    product: { price: 12, status: 'live' },
  }])
  let got = s.read('.status=live')
  assertEquals(got.length, 1)
  assertEquals(got[0].eid, 'p1')
  assertEquals(c(got[0], 'product').price, 12)
  assertEquals(c(got[0], 'doc').title, 'Mug')
})

Deno.test('a patch touches only the columns it names', () => {
  let s = store()
  s.write([{ eid: 'p1', product: { price: 12, status: 'live' } }])
  s.write([{ eid: 'p1', product: { price: 15 } }])
  let [p] = s.read('.kind=product')
  assertEquals(c(p, 'product').price, 15)
  assertEquals(c(p, 'product').status, 'live') // untouched
})

Deno.test('a null column clears it, its siblings untouched', () => {
  let s = store()
  s.write([{ eid: 'p1', product: { price: 12, status: 'live' } }])
  s.write([{ eid: 'p1', product: { status: null } }])
  let [p] = s.read('.kind=product')
  assertEquals(c(p, 'product').status, null)
  assertEquals(c(p, 'product').price, 12)
})

Deno.test('a null component drops the row, the entity survives', () => {
  let s = store()
  s.write([{ eid: 'p1', doc: { title: 'Mug' }, product: { price: 12 } }])
  s.write([{ eid: 'p1', product: null }])
  let [p] = s.read('.title~=mug')
  assert(p)
  assertEquals(p.product, undefined)
  assertEquals(c(p, 'doc').title, 'Mug')
})

Deno.test('a boolean round-trips through integer storage', () => {
  let s = store()
  s.write([{ eid: 'p1', product: { available: true } }])
  assertEquals(c(s.read('.kind=product')[0], 'product').available, 1)
})

Deno.test('deleting an entity tombstones it and it leaves every read', () => {
  let s = store()
  s.write([{ eid: 'p1', doc: { title: 'Mug' } }])
  let dead = s.write([{ eid: 'p1', entity: null }])
  assertEquals(dead, ['p1'])
  assertEquals(s.read('.title~=mug').length, 0)
})

Deno.test('a cascade reference pulls its owner into the grave', () => {
  let s = store()
  s.write([
    { eid: 'p1', product: { price: 12 } },
    { eid: 'r1', review: { stars: 5, product: 'p1' } },
  ])
  assertEquals(s.read('.kind=review').length, 1)
  let dead = s.write([{ eid: 'p1', entity: null }]).sort()
  assertEquals(dead, ['p1', 'r1'])
  assertEquals(s.read('.kind=review').length, 0)
})

Deno.test('a detach reference is nulled when its target dies', () => {
  let s = store()
  s.write([
    { eid: 'm1', doc: { title: 'Acme' } },
    { eid: 'p1', product: { price: 12, maker: 'm1' } },
  ])
  let dead = s.write([{ eid: 'm1', entity: null }])
  assertEquals(dead, ['m1']) // only the maker died
  assertEquals(c(s.read('.kind=product')[0], 'product').maker, null)
})

Deno.test('a release reference drops its row, its owner lives', () => {
  let s = store()
  s.write([
    { eid: 'u1', doc: { title: 'Reader' } },
    { eid: 'd1', doc: { title: 'Manual' } },
    { eid: 'u1', bookmark: { of: 'd1' } },
  ])
  let dead = s.write([{ eid: 'd1', entity: null }])
  assertEquals(dead, ['d1'])
  let u = s.read('.title~=reader')[0]
  assert(u) // owner survives
  assertEquals(u.bookmark, undefined) // the bookmark row is gone
})

Deno.test('a write with no deletion returns no casualties', () => {
  let s = store()
  assertEquals(s.write([{ eid: 'p1', product: { price: 1 } }]), [])
})
