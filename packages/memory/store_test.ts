/// <reference lib="deno.ns" />
// The map itself: what a patch does to a record, what identity storage mints,
// what a query reads back, and what a rolled-back transaction leaves behind.
// The whole-stack agreement with a database lives in ./parity_test.ts.
//
// The vocabulary is @yaks/sqlite's shop fixture, so both test files in this
// package — and the adapter they hold against each other — speak one domain.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { shop } from '../sqlite/harness.ts'
import { memory, type Store } from './mod.ts'

let put = (s: Store, ...bundles: Bundle[]) => s.tx((tx) => tx.patch(bundles))
let at = (s: Store, eid: string) => s.tx((tx) => tx.get([eid]))[0]
let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? {}) as Record<string, unknown>

Deno.test('a patch mints identity in first-touch order and says what it minted', () => {
  let s = memory(shop)
  let born = put(
    s,
    { entity: { eid: 'p1' }, doc: { title: 'Mug' } },
    { entity: { eid: 'p2' }, doc: { title: 'Cup' } },
  )
  assertEquals(born, [{ eid: 'p1', num: 1 }, { eid: 'p2', num: 2 }])
  assertEquals(put(s, { entity: { eid: 'p1' }, doc: { title: 'Mug II' } }), [])
  assertEquals(at(s, 'p1').entity, { eid: 'p1', num: 1 })
})

Deno.test('a patch touches only the columns it names; null clears one', () => {
  let s = memory(shop)
  put(s, { entity: { eid: 'p1' }, product: { price: 12, status: 'live' } })
  put(s, { entity: { eid: 'p1' }, product: { price: 9 } })
  assertEquals(comp(at(s, 'p1'), 'product'), { price: 9, status: 'live' })
  put(s, { entity: { eid: 'p1' }, product: { status: null } })
  assertEquals(comp(at(s, 'p1'), 'product'), { price: 9, status: null })
})

Deno.test('a null component drops it, the entity survives', () => {
  let s = memory(shop)
  put(s, {
    entity: { eid: 'p1' },
    doc: { title: 'Mug' },
    product: { price: 12 },
  })
  put(s, { entity: { eid: 'p1' }, product: null })
  assertEquals(at(s, 'p1').product, undefined)
  assertEquals(comp(at(s, 'p1'), 'doc').title, 'Mug')
})

Deno.test('a reference names an entity the batch mints, in any order', () => {
  let s = memory(shop)
  let born = put(s, {
    entity: { eid: 'r1' },
    review: { stars: 5, product: 'p1' },
  })
  assertEquals(born.map((e) => e.eid), ['r1', 'p1'])
  assertEquals(at(s, 'p1'), { entity: { eid: 'p1', num: 2 } })
})

Deno.test('a removed entity is tombstoned, and takes no patch after', () => {
  let s = memory(shop)
  put(s, { entity: { eid: 'p1' }, doc: { title: 'Mug' } })
  s.tx((tx) => tx.remove([{ eid: 'p1' }]))
  assertEquals(at(s, 'p1'), { entity: { eid: 'p1', num: 1 }, tombstone: {} })
  put(s, { entity: { eid: 'p1' }, doc: { title: 'back from the dead' } })
  assertEquals(at(s, 'p1').doc, undefined)
  assertEquals(s.read('.kind=doc'), [])
})

Deno.test('a read is the query grammar, answered from the map', () => {
  let s = memory(shop)
  put(
    s,
    { entity: { eid: 'p1' }, doc: { title: 'Mug' }, product: { price: 12 } },
    { entity: { eid: 'p2' }, doc: { title: 'Cup' }, product: { price: 4 } },
    { entity: { eid: 'd1' }, doc: { title: 'Manual' } },
  )
  assertEquals(s.read('.price<10').map((b) => b.entity.eid), ['p2'])
  assertEquals(s.read('.kind=product&.order=-price').map((b) => b.entity.eid), [
    'p1',
    'p2',
  ])
  assertEquals(s.rows('.price<10'), [{ eid: 'p2' }])
})

Deno.test('a throwing transaction leaves the map exactly as it was', () => {
  let s = memory(shop)
  put(s, { entity: { eid: 'p1' }, product: { price: 12 } })
  let before = s.read('')
  assertThrows(() =>
    s.tx((tx) => {
      tx.patch([
        { entity: { eid: 'p2' }, product: { price: 1 } },
        { entity: { eid: 'p1' }, product: { price: 99 } },
      ])
      tx.remove([{ eid: 'p1' }])
      throw new Error('refused')
    })
  )
  assertEquals(s.read(''), before)
  // the numbers the rolled-back batch minted are handed out again
  assertEquals(put(s, { entity: { eid: 'p3' }, product: {} }), [{
    eid: 'p3',
    num: 2,
  }])
})

Deno.test('a nested transaction rolls back to where it opened', () => {
  let s = memory(shop)
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'p1' }, doc: { title: 'Mug' } }])
    assertThrows(() =>
      s.tx((inner) => {
        inner.patch([{ entity: { eid: 'p2' }, doc: { title: 'Cup' } }])
        throw new Error('inner')
      })
    )
    return tx
  })
  assert(at(s, 'p1'))
  assertEquals(at(s, 'p2'), undefined)
})

Deno.test('an outer rollback undoes what an inner transaction committed', () => {
  let s = memory(shop)
  assertThrows(() =>
    s.tx(() => {
      s.tx((inner) => inner.patch([{ entity: { eid: 'p1' }, doc: {} }]))
      throw new Error('outer')
    })
  )
  assertEquals(at(s, 'p1'), undefined)
})

Deno.test('a map has no schema: ddl is empty and install does nothing', () => {
  let s = memory(shop)
  assertEquals(s.ddl(), [])
  assertEquals(s.install(), undefined)
})
