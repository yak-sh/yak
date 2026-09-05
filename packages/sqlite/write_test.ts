// Writes patch: a bundle names only what changes. These pin the storage half —
// the four patch rules, the identity a patch mints, and the row-level removal
// @yaks/graph asks for. WHICH entities a delete takes with it is the graph's
// decision, held in ./graph_test.ts.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from './bundle.ts'
import type { Driver } from './driver.ts'
import { mem, shop, store } from './harness.ts'
import { storage } from './mod.ts'

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

Deno.test('a declared unique refuses the second writer of the value', () => {
  let s = store()
  write(s, [{ entity: { eid: 'p1' }, product: { sku: 'MUG-1' } }])
  let threw = false
  try {
    write(s, [{ entity: { eid: 'p2' }, product: { sku: 'MUG-1' } }])
  } catch {
    threw = true
  }
  assert(threw)
  // The loser wrote nothing at all — the batch's transaction went with it.
  assertEquals(s.tx((tx) => tx.get(['p2'])), [])
})

Deno.test('a composite unique refuses only the whole pair', () => {
  let s = store()
  write(s, [{ entity: { eid: 's1' }, shelf: { aisle: 'A', slot: 1 } }])
  // The same aisle in another slot is fine.
  write(s, [{ entity: { eid: 's2' }, shelf: { aisle: 'A', slot: 2 } }])
  let threw = false
  try {
    write(s, [{ entity: { eid: 's3' }, shelf: { aisle: 'A', slot: 1 } }])
  } catch {
    threw = true
  }
  assert(threw)
})

// The write path is shared with @yaks/d1, which cannot read mid-batch, so it
// must not ask the database a BLOCKING question to build a write. A `select` is
// such a question — its answer has to arrive before the next statement is
// built — while a write's own RETURNING rides back with the batch, which is why
// the numbers a mint hands out cost nothing here. What is left is one question
// about IDENTITY: which of the named eids are already in the grave. It does not
// multiply with the batch.
Deno.test('a patch asks once about identity, whatever the batch is', () => {
  let seen: string[] = []
  let base = mem()
  let driver: Driver = {
    query: (sql, params) => {
      seen.push(sql)
      return base.query(sql, params)
    },
    exec: (sql) => base.exec(sql),
  }
  let s = storage(driver, shop)
  s.install()
  let asked = () => {
    let n = seen.filter((q) => q.trimStart().startsWith('select')).length
    seen.length = 0
    return n
  }

  asked() // forget what install() asked
  write(s, [{ entity: { eid: 'p1' }, product: { price: 12, maker: 'm1' } }])
  assertEquals(asked(), 1)

  write(s, [
    { entity: { eid: 'p2' }, doc: { title: 'Mug' }, product: { price: 1 } },
    { entity: { eid: 'r1' }, review: { stars: 5, product: 'p2' } },
    { entity: { eid: 'p1' }, product: { price: 9 } },
  ])
  assertEquals(asked(), 1)

  // A batch that mints nothing asks the same one question.
  write(s, [{ entity: { eid: 'p1' }, product: { price: 3 } }])
  assertEquals(asked(), 1)

  s.tx((tx) => tx.remove([{ eid: 'p1' }]))
  assertEquals(asked(), 0)
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
