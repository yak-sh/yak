// The whole stack: @yaks/graph's apply() over this adapter. The graph decides
// (admission, preconditions, who dies with what, provenance), this package
// stores. These hold the seam where the two meet — including the death words,
// which used to be SQL in here and are now a rule read off the vocabulary.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { isPromise, Stale, token } from '@yaks/graph'
import { shopGraph } from './harness.ts'

let sync = (out: Bundle[] | Promise<Bundle[]>): Bundle[] => {
  assert(!isPromise(out), 'apply() went async over an embedded database')
  return out
}

let one = (g: ReturnType<typeof shopGraph>, q: string) =>
  (g.read(q) as Bundle[])[0]

Deno.test('apply lands a batch and stamps it, synchronously', () => {
  let g = shopGraph()
  let out = sync(g.apply(
    [{
      entity: { eid: 'p1' },
      doc: { title: 'Mug' },
      product: { price: 12 },
      $actor: { by: 'p1' },
    }],
    { now: '2026-03-01T00:00:00.000Z' },
  ))
  assert(out.some((b) => b.entity.num === 1))
  let p = one(g, '.kind=product')
  assertEquals(
    (p.created as Record<string, unknown>).at,
    '2026-03-01T00:00:00.000Z',
  )
})

Deno.test('admission refuses an unknown column through the whole stack', () => {
  let g = shopGraph()
  assertThrows(
    () => sync(g.apply([{ entity: { eid: 'p1' }, product: { pricee: 1 } }])),
    Error,
    'product.pricee',
  )
})

Deno.test('a $was guard reads through the transaction', () => {
  let g = shopGraph()
  sync(g.apply([{ entity: { eid: 'p1' }, doc: { title: 'Mug' } }]))
  sync(g.apply([{
    entity: { eid: 'p1' },
    doc: { title: 'Cup' },
    $was: { doc: { title: token('Mug') } },
  }]))
  assertEquals(
    (one(g, '.kind=doc').doc as Record<string, unknown>).title,
    'Cup',
  )
  assertThrows(
    () =>
      sync(g.apply([{
        entity: { eid: 'p1' },
        doc: { title: 'Mug again' },
        $was: { doc: { title: token('Mug') } },
      }])),
    Stale,
  )
})

Deno.test('a cascade reference pulls its owner into the grave', () => {
  let g = shopGraph()
  sync(g.apply([
    { entity: { eid: 'p1' }, product: { price: 12 } },
    { entity: { eid: 'r1' }, review: { stars: 5, product: 'p1' } },
  ]))
  assertEquals((g.read('.kind=review') as Bundle[]).length, 1)
  let out = sync(g.apply([{ entity: { eid: 'p1' }, $delete: true }]))
  assert(out.some((b) => b.entity.eid == 'r1' && b.tombstone))
  assertEquals(g.read('.kind=review'), [])
  assertEquals(g.read('.kind=product'), [])
})

Deno.test('a detach reference is nulled when its target dies', () => {
  let g = shopGraph()
  sync(g.apply([
    { entity: { eid: 'm1' }, doc: { title: 'Acme' } },
    { entity: { eid: 'p1' }, product: { price: 12, maker: 'm1' } },
  ]))
  let out = sync(g.apply([{ entity: { eid: 'm1' }, $delete: true }]))
  assertEquals(
    out.find((b) => b.entity.eid == 'p1')!.product,
    { maker: null },
  )
  let p = one(g, '.kind=product')
  assertEquals((p.product as Record<string, unknown>).maker, null)
})

Deno.test('a release reference drops its row, its owner lives', () => {
  let g = shopGraph()
  sync(g.apply([
    { entity: { eid: 'u1' }, doc: { title: 'Reader' } },
    { entity: { eid: 'd1' }, doc: { title: 'Manual' } },
    { entity: { eid: 'u1' }, bookmark: { of: 'd1' } },
  ]))
  sync(g.apply([{ entity: { eid: 'd1' }, $delete: true }]))
  let u = one(g, '.title~=reader')
  assert(u)
  assertEquals(u.bookmark, undefined)
})

Deno.test('a refused batch leaves the database as it was', () => {
  let g = shopGraph()
  sync(g.apply([{ entity: { eid: 'p1' }, product: { price: 12 } }]))
  assertThrows(() =>
    sync(g.apply([
      { entity: { eid: 'p2' }, product: { price: 1 } },
      {
        entity: { eid: 'p1' },
        product: { price: 2 },
        $was: { product: { price: token(999) } },
      },
    ]))
  )
  assertEquals(g.read('.kind=product') as Bundle[], [
    ...(g.read(`.price=12`) as Bundle[]),
  ])
  assertEquals((g.read('.kind=product') as Bundle[]).length, 1)
})
