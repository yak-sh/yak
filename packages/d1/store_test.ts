/// <reference lib="deno.ns" />
// What the parity script cannot see, because the reference adapter has no such
// boundary: the batch itself. These hold the promises this package makes about
// D1's grain — one atomic write batch, reads that see the transaction's own
// pending writes, and nothing sent at all when a transaction throws.

import { assert, assertEquals, assertRejects } from '@std/assert'
import { graph } from '@yaks/graph'
import type { Bundle } from '@yaks/graph'
import { counted, d1, shop, store } from './harness.ts'
import { storage } from './store.ts'

let titles = (bs: Bundle[]) =>
  bs.map((b) => (b.doc as { title?: string })?.title).sort()

Deno.test('a store reads back what it wrote', async () => {
  let s = await store()
  await s.tx((tx) =>
    tx.patch([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }])
  )
  assertEquals(titles(await s.read('.kind=doc')), ['Dune'])
})

Deno.test('a transaction that throws sends nothing', async () => {
  let s = await store()
  await assertRejects(() =>
    s.tx(async (tx) => {
      await tx.patch([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }])
      throw new Error('no')
    })
  )
  assertEquals(await s.read('.kind=doc'), [])
})

Deno.test('a transaction reads its own pending writes', async () => {
  let s = await store()
  let seen = await s.tx(async (tx) => {
    await tx.patch([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }])
    return await tx.read('.kind=doc')
  })
  assertEquals(titles(seen as Bundle[]), ['Dune'])
  // …and only once the transaction returned did anything land.
  assertEquals(titles(await s.read('.kind=doc')), ['Dune'])
})

Deno.test('a pending write that no longer matches drops out of a read', async () => {
  let s = await store()
  await s.tx((tx) =>
    tx.patch([{ entity: { eid: 'p1' }, product: { status: 'live' } }])
  )
  let seen = await s.tx(async (tx) => {
    await tx.patch([{ entity: { eid: 'p1' }, product: { status: 'draft' } }])
    return await tx.read('.status=live')
  })
  assertEquals(seen as Bundle[], [])
})

Deno.test('a whole read is one round trip, and the same answer', async () => {
  let { store: s, hops, reset } = await counted()
  let g = graph({ storage: s, vocab: shop })
  await g.apply([
    { entity: { eid: 'm1' }, doc: { title: 'Acme' } },
    { entity: { eid: 'p1' }, product: { sku: 'MUG', price: 12, maker: 'm1' } },
    { entity: { eid: 'p2' }, product: { sku: 'CUP', price: 9, maker: 'm1' } },
    { entity: { eid: 'p3' }, product: { sku: 'JUG', price: 4 } },
  ])
  let [slow, fast, trips] = await s.tx(async (tx) => {
    let slow = await tx.read('.product.maker=m1')
    reset()
    let fast = await tx.whole!('.product.maker=m1')
    return [slow, fast, hops().trips]
  })
  // Same entities, whole, in the same order — the door differs, not the answer.
  assertEquals(fast, slow)
  assertEquals(titles(slow as Bundle[]).length, 2)
  assertEquals(trips, 1)
})

Deno.test('a whole read sees pending writes too', async () => {
  let s = await store()
  await s.tx((tx) =>
    tx.patch([{ entity: { eid: 'm1' }, doc: { title: 'Acme' } }])
  )
  let seen = await s.tx(async (tx) => {
    await tx.patch([{ entity: { eid: 'p1' }, product: { maker: 'm1' } }])
    return await tx.whole!('.product.maker=m1')
  })
  assertEquals((seen as Bundle[]).map((b) => b.entity.eid), ['p1'])
})

Deno.test('the whole write goes as one batch', async () => {
  let db = d1()
  let sizes: number[] = []
  let batch = db.batch
  let watched = {
    prepare: db.prepare,
    batch: (stmts: Parameters<typeof batch>[0]) => {
      sizes.push(stmts.length)
      return batch(stmts)
    },
  }
  let s = storage(watched, shop)
  await s.install()
  sizes.length = 0
  let g = graph({ storage: s, vocab: shop })
  await g.apply([
    { entity: { eid: 'b1' }, doc: { title: 'Dune' } },
    { entity: { eid: 'b2' }, doc: { title: 'Emma' } },
  ])
  // Reads gather in batches too, so what matters is that the WRITE was one:
  // the last batch of the apply is the flush, and it carries every statement.
  assert(sizes.at(-1)! > 1, `the flush should carry the batch: ${sizes}`)
})

Deno.test('a number a refused batch reserved is handed out again', async () => {
  let s = await store()
  let g = graph({ storage: s, vocab: shop })
  await assertRejects(() =>
    Promise.resolve(g.apply([{ entity: { eid: 'x' }, doc: { title: 'boom' } }, {
      entity: { eid: 'y' },
      $was: { doc: { title: 'nope' } },
    }]))
  )
  await g.apply([{ entity: { eid: 'z' }, doc: { title: 'Dune' } }])
  assertEquals((await s.read('.kind=doc'))[0].entity.num, 1)
})
