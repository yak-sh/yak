// Writes patch: a bundle names only what changes. These pin the storage half —
// the four patch rules, the identity a patch mints, and the row-level removal
// @yaks/graph asks for. WHICH entities a delete takes with it is the graph's
// decision, held in ./graph_test.ts.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from './bundle.ts'
import { store } from './harness.ts'

let c = (b: Bundle, name: string): Comp => b[name] as Comp

// A batch through the store's transaction — what a graph does for real.
let write = (s: ReturnType<typeof store>, bundles: Bundle[]) =>
  s.tx((tx) => tx.patch(bundles))

Deno.test('a bundle creates an entity wearing its components', () => {
  let s = store()
  write(s, [{
    entity: { eid: 'p1' },
    doc: { title: 'Mug' },
    product: { price: 12, status: 'live' },
  }])
  let got = s.read('.status=live') as Bundle[]
  assertEquals(got.length, 1)
  assertEquals(got[0].entity.eid, 'p1')
  assertEquals(c(got[0], 'product').price, 12)
  assertEquals(c(got[0], 'doc').title, 'Mug')
})

Deno.test('a patch mints identity once and reports the number', () => {
  let s = store()
  let born = write(s, [{ entity: { eid: 'p1' }, product: { price: 12 } }])
  assertEquals(born.length, 1)
  assertEquals(born[0].eid, 'p1')
  assertEquals(born[0].num, 1)
  // a second touch of the same eid is no birth
  assertEquals(
    write(s, [{ entity: { eid: 'p1' }, product: { price: 13 } }]),
    [],
  )
})

Deno.test('a patch touches only the columns it names', () => {
  let s = store()
  write(s, [{ entity: { eid: 'p1' }, product: { price: 12, status: 'live' } }])
  write(s, [{ entity: { eid: 'p1' }, product: { price: 15 } }])
  let [p] = s.read('.kind=product') as Bundle[]
  assertEquals(c(p, 'product').price, 15)
  assertEquals(c(p, 'product').status, 'live') // untouched
})

Deno.test('a null column clears it, its siblings untouched', () => {
  let s = store()
  write(s, [{ entity: { eid: 'p1' }, product: { price: 12, status: 'live' } }])
  write(s, [{ entity: { eid: 'p1' }, product: { status: null } }])
  let [p] = s.read('.kind=product') as Bundle[]
  assertEquals(c(p, 'product').status, null)
  assertEquals(c(p, 'product').price, 12)
})

Deno.test('a null component drops the row, the entity survives', () => {
  let s = store()
  write(s, [{
    entity: { eid: 'p1' },
    doc: { title: 'Mug' },
    product: { price: 12 },
  }])
  write(s, [{ entity: { eid: 'p1' }, product: null }])
  let [p] = s.read('.title~=mug') as Bundle[]
  assert(p)
  assertEquals(p.product, undefined)
  assertEquals(c(p, 'doc').title, 'Mug')
})

Deno.test('a boolean round-trips through integer storage', () => {
  let s = store()
  write(s, [{ entity: { eid: 'p1' }, product: { available: true } }])
  let [p] = s.read('.kind=product') as Bundle[]
  assertEquals(c(p, 'product').available, 1)
})

Deno.test('a reference may name a target minted later in the same batch', () => {
  let s = store()
  write(s, [
    { entity: { eid: 'r1' }, review: { stars: 5, product: 'p1' } },
    { entity: { eid: 'p1' }, product: { price: 12 } },
  ])
  let [r] = s.read('.kind=review') as Bundle[]
  assertEquals(c(r, 'review').product, 'p1')
})

Deno.test('remove drops every component row and tombstones the identity', () => {
  let s = store()
  write(s, [{ entity: { eid: 'p1' }, doc: { title: 'Mug' } }])
  s.tx((tx) => tx.remove([{ eid: 'p1' }]))
  assertEquals(s.read('.title~=mug'), [])
  let [b] = s.tx((tx) => tx.get(['p1'])) as Bundle[]
  assertEquals(b.tombstone, {}) // still an identity, just a dead one
  assertEquals(b.doc, undefined)
})

Deno.test('a tombstoned entity takes no patch, ever', () => {
  let s = store()
  write(s, [{ entity: { eid: 'p1' }, doc: { title: 'Mug' } }])
  s.tx((tx) => tx.remove([{ eid: 'p1' }]))
  assertEquals(
    write(s, [{ entity: { eid: 'p1' }, doc: { title: 'back' } }]),
    [],
  )
  let [b] = s.tx((tx) => tx.get(['p1'])) as Bundle[]
  assertEquals(b.doc, undefined)
})

Deno.test('get answers by identity, and says nothing about an unknown eid', () => {
  let s = store()
  write(s, [{ entity: { eid: 'p1' }, product: { price: 12 } }])
  let got = s.tx((tx) => tx.get(['p1', 'nope'])) as Bundle[]
  assertEquals(got.length, 1)
  assertEquals(got[0].entity.num, 1)
})

Deno.test('a transaction rolls back on a throw, and nests', () => {
  let s = store()
  write(s, [{ entity: { eid: 'p1' }, product: { price: 12 } }])
  let threw = false
  try {
    s.tx((tx) => {
      tx.patch([{ entity: { eid: 'p2' }, product: { price: 1 } }])
      s.tx((inner) => inner.patch([{ entity: { eid: 'p3' }, product: {} }]))
      throw new Error('no')
    })
  } catch {
    threw = true
  }
  assert(threw)
  assertEquals(s.tx((tx) => tx.get(['p2', 'p3'])), [])
  assertEquals((s.tx((tx) => tx.get(['p1'])) as Bundle[]).length, 1)
})
