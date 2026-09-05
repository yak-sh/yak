/// <reference lib="deno.ns" />
// The store over the object's own SQLite: the schema installs, a batch lands,
// and the two things the runtime is strict about — what may be bound, and who
// owns a transaction — hold. The stand-in refuses anything workerd would, so
// each of these fails loudly rather than only in production.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { durable, shop, store } from './harness.ts'
import { storage } from './store.ts'

let comp = (b: Bundle, name: string) => b[name] as Record<string, unknown>

Deno.test('install is idempotent, and a bundle survives the round trip', () => {
  let s = store()
  s.install() // create-if-not-exists: a woken object may call it every time
  s.tx((tx) =>
    tx.patch([{
      entity: { eid: 'p1' },
      doc: { title: 'Kettle' },
      product: { price: 40, available: true, status: 'live' },
    }])
  )
  let [p] = s.read('.kind=product') as Bundle[]
  assertEquals(p.entity.eid, 'p1')
  assertEquals(comp(p, 'doc').title, 'Kettle')
  // A boolean would bind as the text 'true'; it lands as the 1 the column holds.
  assertEquals(comp(p, 'product').available, 1)
})

Deno.test('bytes go in as an ArrayBuffer and come back as bytes', () => {
  let s = store()
  s.tx((tx) =>
    tx.patch([{
      entity: { eid: 'd1' },
      doc: { body: new Uint8Array([1, 2, 3]) },
    }])
  )
  let [d] = s.tx((tx) => tx.get(['d1']))
  assertEquals(comp(d, 'doc').body, new Uint8Array([1, 2, 3]))
})

Deno.test("the transaction is the runtime's, and it rolls back", () => {
  let s = store()
  assertThrows(() =>
    s.tx((tx) => {
      tx.patch([{ entity: { eid: 'p1' }, doc: { title: 'Kettle' } }])
      throw new Error('no')
    })
  )
  assertEquals(s.read('.kind=doc'), [])
})

Deno.test('a value the engine will not take never reaches it', () => {
  // The stand-in throws on anything but an ArrayBuffer, string, number or
  // null — so this passing is the proof the driver converts.
  let s = storage(durable(), shop)
  s.install()
  s.tx((tx) =>
    tx.patch([{
      entity: { eid: 'p1' },
      product: { price: 1, available: false },
    }])
  )
  assert(s.read('.available=0').length == 1)
})
