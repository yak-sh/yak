// Writes patch: a bundle names only what changes. These pin the storage half —
// the four patch rules, the identity a patch mints, and the row-level removal
// @yaks/graph asks for. Which entities a delete takes with it is the graph's
// decision, held in ./graph_test.ts.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertIsError, assertRejects } from '@std/assert'
import type { Bundle, Comp } from './bundle.ts'
import { mem, shop, spy, store } from './testing.ts'
import { storage } from './mod.ts'
import { graph } from '@yaks/graph'
import { lit } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'

let c = (b: Bundle, name: string): Comp => b[name] as Comp

// A batch through the store's transaction — what a graph does for real.
let write = async (
  s: ReturnType<typeof store>,
  bundles: Bundle[],
) => (await s.tx((tx) => tx.patch(bundles)))

test('a bundle creates an entity wearing its components', async () => {
  let s = store()
  await write(s, [{
    entity: { eid: 'p1' },
    doc: { title: 'Mug' },
    product: { price: 12, status: 'live' },
  }])
  let got = s.read('.product.status=live') as Bundle[]
  assertEquals(got.length, 1)
  assertEquals(got[0].entity.eid, 'p1')
  assertEquals(c(got[0], 'product').price, 12)
  assertEquals(c(got[0], 'doc').title, 'Mug')
})

test('a patch mints identity once and reports the number', async () => {
  let s = store()
  let born = await write(s, [{ entity: { eid: 'p1' }, product: { price: 12 } }])
  assertEquals(born.length, 1)
  assertEquals(born[0].eid, 'p1')
  assertEquals(born[0].num, 1)
  // a second touch of the same eid is no birth
  assertEquals(
    await write(s, [{ entity: { eid: 'p1' }, product: { price: 13 } }]),
    [],
  )
})

test('a patch touches only the properties it names', async () => {
  let s = store()
  await write(s, [{
    entity: { eid: 'p1' },
    product: { price: 12, status: 'live' },
  }])
  await write(s, [{ entity: { eid: 'p1' }, product: { price: 15 } }])
  let [p] = s.read('.kind=product') as Bundle[]
  assertEquals(c(p, 'product').price, 15)
  assertEquals(c(p, 'product').status, 'live') // untouched
})

test('a null property clears it, its siblings untouched', async () => {
  let s = store()
  await write(s, [{
    entity: { eid: 'p1' },
    product: { price: 12, status: 'live' },
  }])
  await write(s, [{ entity: { eid: 'p1' }, product: { status: null } }])
  let [p] = s.read('.kind=product') as Bundle[]
  assertEquals(c(p, 'product').status, undefined)
  assertEquals(c(p, 'product').price, 12)
})

let dropped = store()
await write(dropped, [{
  entity: { eid: 'p1' },
  doc: { title: 'Mug' },
  product: { price: 12 },
}])
test('a null component drops the row, the entity survives', async () => {
  let s = dropped
  await write(s, [{ entity: { eid: 'p1' }, product: null }])
  let [p] = s.get(['p1'])
  assert(p)
  assertEquals(p.product, undefined)
  assertEquals(c(p, 'doc').title, 'Mug')
})

let booleans = store()
await write(booleans, [
  { entity: { eid: 'p1' }, product: { available: true } },
  { entity: { eid: 'p2' }, product: { available: false } },
])
test('a boolean round-trips through integer storage', () => {
  let s = booleans
  let read = (q: string) =>
    (s.read(q) as Bundle[]).map((b) => c(b, 'product').available)
  assertEquals(read('.product.available=1'), [true])
  assertEquals(read('.product.available=0'), [false])
})

test('a reference may name a target minted later in the same batch', async () => {
  let s = store()
  await write(s, [
    { entity: { eid: 'r1' }, review: { stars: 5, product: 'p1' } },
    { entity: { eid: 'p1' }, product: { price: 12 } },
  ])
  let [r] = s.read('.kind=review') as Bundle[]
  assertEquals(c(r, 'review').product, 'p1')
})

test('remove drops every component row and tombstones the identity', async () => {
  let s = store()
  await write(s, [{ entity: { eid: 'p1' }, doc: { title: 'Mug' } }])
  await s.tx((tx) => tx.remove([{ eid: 'p1' }]))
  assertEquals(s.read('.doc.title~=mug'), [])
  let [b] = (await s.tx((tx) => tx.get(['p1']))) as Bundle[]
  assertEquals(b.tombstone, {}) // still an identity, just a dead one
  assertEquals(b.doc, undefined)
})

test('a tombstoned entity takes no patch until it is revived', async () => {
  let s = store()
  await write(s, [{ entity: { eid: 'p1' }, doc: { title: 'Mug' } }])
  await s.tx((tx) => tx.remove([{ eid: 'p1' }]))
  assertEquals(
    await write(s, [{ entity: { eid: 'p1' }, doc: { title: 'back' } }]),
    [],
  )
  let [b] = (await s.tx((tx) => tx.get(['p1']))) as Bundle[]
  assertEquals(b.doc, undefined)
  await s.tx((tx) => tx.revive(['p1']))
  assertEquals(
    await write(s, [{ entity: { eid: 'p1' }, doc: { title: 'back' } }]),
    [],
  )
  let [back] = (await s.tx((tx) => tx.get(['p1']))) as Bundle[]
  assertEquals(back.entity, { eid: 'p1', num: 1 })
  assertEquals(back.tombstone, undefined)
  assertEquals(c(back, 'doc').title, 'back')
})

test('get answers by identity, and says nothing about an unknown eid', async () => {
  let s = store()
  await write(s, [{ entity: { eid: 'p1' }, product: { price: 12 } }])
  let got = (await s.tx((tx) => tx.get(['p1', 'nope']))) as Bundle[]
  assertEquals(got.length, 1)
  assertEquals(got[0].entity.num, 1)
})

test('a declared unique refuses the second writer of the value', async () => {
  let s = store()
  await write(s, [{ entity: { eid: 'p1' }, product: { sku: 'MUG-1' } }])
  let threw = false
  try {
    await write(s, [{ entity: { eid: 'p2' }, product: { sku: 'MUG-1' } }])
  } catch {
    threw = true
  }
  assert(threw)
  // The loser wrote nothing at all — the batch's transaction went with it.
  assertEquals(await s.tx((tx) => tx.get(['p2'])), [])
})

test('a composite unique refuses only the whole pair', async () => {
  let s = store()
  await write(s, [{ entity: { eid: 's1' }, shelf: { aisle: 'A', slot: 1 } }])
  // The same aisle in another slot is fine.
  await write(s, [{ entity: { eid: 's2' }, shelf: { aisle: 'A', slot: 2 } }])
  let threw = false
  try {
    await write(s, [{ entity: { eid: 's3' }, shelf: { aisle: 'A', slot: 1 } }])
  } catch {
    threw = true
  }
  assert(threw)
})

// The write path is shared with @yaks/d1, which cannot read mid-batch, so it
// must not ask the database a blocking question to build a write. A `select` is
// such a question — its answer has to arrive before the next statement is
// built — while a write's own RETURNING rides back with the batch, which is why
// the numbers a mint hands out cost nothing here. What is left is one question
// about identity: which of the named eids are already in the grave. It does not
// multiply with the batch, and an eid the connection holds the spine of is not
// asked about again.
test('a patch asks once about identity, whatever the batch is', async () => {
  let seen: string[] = []
  let driver = spy(mem(), (sql) => void seen.push(sql))
  let s = storage(driver, shop)
  s.install()
  // What a first write makes (./raise.ts) is no question about identity.
  s.raise()
  let asked = () => {
    let n = seen.filter((q) => q.trimStart().startsWith('select')).length
    seen.length = 0
    return n
  }

  // Nor is the first entity of a shape, which mints the archetype every
  // later one is born pointing at (./archetype.ts).
  await write(s, [
    { entity: { eid: 'w1' }, product: { price: 1, maker: 'w0' } },
    { entity: { eid: 'w2' }, doc: { title: 'Cup' }, product: { price: 1 } },
    { entity: { eid: 'w3' }, review: { stars: 1, product: 'w2' } },
  ])
  await s.tx((tx) => tx.remove([{ eid: 'w3' }]))
  asked() // forget what install() and those asked
  await write(s, [{
    entity: { eid: 'p1' },
    product: { price: 12, maker: 'm1' },
  }])
  assertEquals(asked(), 1)

  await write(s, [
    { entity: { eid: 'p2' }, doc: { title: 'Mug' }, product: { price: 1 } },
    { entity: { eid: 'r1' }, review: { stars: 5, product: 'p2' } },
    { entity: { eid: 'p1' }, product: { price: 9 } },
  ])
  assertEquals(asked(), 1)

  // A batch of entities already asked about asks nothing.
  await write(s, [{ entity: { eid: 'p1' }, product: { price: 3 } }])
  assertEquals(asked(), 0)

  // A removal reads which tables its entities hold, off their pointers.
  await s.tx((tx) => tx.remove([{ eid: 'p1' }]))
  assertEquals(asked(), 1)
})

// Prepare the nested store rollback once, including its transaction bookkeeping.
let rollback = store()
await write(rollback, [{ entity: { eid: 'p1' }, product: { price: 12 } }])
let rollbackError: unknown
try {
  await rollback.tx(async (tx) => {
    tx.patch([{ entity: { eid: 'p2' }, product: { price: 1 } }])
    await rollback.tx((inner) =>
      inner.patch([{ entity: { eid: 'p3' }, product: {} }])
    )
    throw new Error('no')
  })
} catch (error) {
  rollbackError = error
}
test('a transaction rolls back on a throw, and nests', async () => {
  assertIsError(rollbackError)
  assertEquals(rollbackError.message, 'no')
  assertEquals(await rollback.tx((tx) => tx.get(['p2', 'p3'])), [])
  assertEquals((await rollback.tx((tx) => tx.get(['p1']))).length, 1)
})

test('numbering exceptions ask once across tables and entities', async () => {
  let selects = 0
  let driver = spy(mem(), (sql, params) => {
    if (/^select .* from "entity"/.test(sql.trimStart())) selects++
    assert(params.length <= 100)
  })
  let open = () =>
    storage(driver, shop, {
      number: { except: ['shelf', 'bookmark', 'review', 'undeclared'] },
    })
  let s = open()
  s.install()
  let products = Array.from({ length: 150 }, (_, i) => ({
    entity: { eid: `p${i}` },
    product: { price: i },
  }))
  await write(s, [
    ...products,
    { entity: { eid: 's' }, shelf: { aisle: 'A', slot: 1 } },
    { entity: { eid: 'r' }, review: { stars: 5 } },
    // The shapes the two will move to, so their archetypes stand.
    { entity: { eid: 's2' }, shelf: { aisle: 'A', slot: 2 }, doc: {} },
    { entity: { eid: 'r2' }, review: { stars: 5 }, doc: {} },
  ])
  // Another storage over the file holds their identities, but knows nothing
  // of what they wear.
  s = open()
  selects = 0
  await write(s, [
    ...products,
    { entity: { eid: 's' }, doc: { title: 'Shelf' } },
    { entity: { eid: 'r' }, doc: { title: 'Review' } },
  ])
  // Exception presence, for the batch, and the pointers of the two whose
  // shape moved; identity held.
  assertEquals(selects, 2)
  let rows = await s.tx((tx) => tx.get(['p0', 'p149', 's', 'r']))
  assertEquals(rows.map((b) => b.entity.num ?? null), [1, 150, null, null])
})

test('a patch asks about numbering exceptions only where they decide a number', async () => {
  let asked = 0
  let driver = spy(mem(), (sql) => {
    if (/^(select|update "entity")/.test(sql.trimStart())) asked++
  })
  let s = storage(driver, shop, { number: { except: ['shelf'] } })
  s.install()
  s.raise()
  await write(s, [
    { entity: { eid: 's' }, shelf: { aisle: 'A', slot: 1 } },
    { entity: { eid: 'p' }, product: { price: 1 } },
    { entity: { eid: 'q' }, product: { price: 1 }, doc: {} },
  ])
  let cost = async (bundles: Bundle[]) => {
    asked = 0
    await write(s, bundles)
    return asked
  }
  // Nothing is read: the bundle names the exception, or gives nothing, and
  // the identity is held.
  assertEquals(await cost([{ entity: { eid: 's' }, shelf: { slot: 2 } }]), 0)
  assertEquals(await cost([{ entity: { eid: 's' }, doc: null }]), 0)
  // Memory knows what an entity it wrote wholly wears: all that is asked is
  // its pointer, read and moved to the shape it takes.
  assertEquals(await cost([{ entity: { eid: 'p' }, doc: { title: 'Mug' } }]), 2)
  // A numbered entity given the exception keeps its existing address.
  await write(s, [{ entity: { eid: 'p' }, shelf: { aisle: 'B', slot: 1 } }])
  assertEquals(
    (await s.tx((tx) => tx.get(['s', 'p']))).map((b) => b.entity.num ?? null),
    [null, 1],
  )
})

test('number:false reports explicit unnumbered births without consuming numbers', async () => {
  let driver = mem()
  let s = storage(driver, shop, { number: false })
  s.install()
  assertEquals(
    await s.tx((tx) =>
      tx.patch([{
        entity: { eid: 'p' },
        product: { maker: 'm' },
      }])
    ),
    [{ eid: 'p', num: null }, { eid: 'm', num: null }],
  )
  assertEquals(
    await s.tx((tx) =>
      tx.patch([{ entity: { eid: 'p' }, product: { price: 3 } }])
    ),
    [],
  )
  let numbered = storage(driver, shop, { number: true })
  assertEquals(
    await numbered.tx((tx) => tx.patch([{ entity: { eid: 'n' }, doc: {} }])),
    [{ eid: 'n', num: 1 }],
  )
})

test('partial updates and bare tags respect required columns and SQL defaults', async () => {
  let d = mem(), s = storage(d, shop)
  s.install()
  s.raise(['doc'])
  d.query({ t: 'drop', kind: 'table', name: 'doc' })
  d.query({
    t: 'create table',
    name: 'doc',
    cols: [
      {
        name: 'entity',
        type: 'integer',
        pk: true,
        ref: { table: 'entity', cols: ['id'] },
      },
      { name: 'title', type: 'text', notNull: true, default: lit('untitled') },
      { name: 'body', type: 'text', notNull: true },
    ],
  })
  await write(s, [{ entity: { eid: 'a' }, doc: { body: 'body' } }])
  await write(s, [{ entity: { eid: 'a' }, doc: { title: 'changed' } }])
  await write(s, [{ entity: { eid: 'a' }, doc: {} }])
  let get = async () => (await s.tx((tx) => tx.get(['a'])))[0]
  assertEquals((await get()).doc, { title: 'changed', body: 'body' })
  await assertRejects(
    async () => (await write(s, [
      { entity: { eid: 'a' }, doc: { title: 'rolled back' } },
      { entity: { eid: 'bad' }, doc: { title: 'missing body' } },
    ])),
    Error,
    'NOT NULL',
  )
  assertEquals((await get()).doc, { title: 'changed', body: 'body' })
  assertEquals(await s.tx((tx) => tx.get(['bad'])), [])
})

test('a table is asked what it requires once while its schema stands', async () => {
  let asked = 0
  let d = spy(mem(), (sql) => {
    if (sql.includes('table_info')) asked++
  })
  let s = storage(d, shop)
  s.install()
  s.raise()
  let cost = async (bundles: Bundle[]) => {
    asked = 0
    await write(s, bundles)
    return asked
  }
  assertEquals(await cost([{ entity: { eid: 'a' }, product: { price: 1 } }]), 1)
  assertEquals(await cost([{ entity: { eid: 'b' }, product: { price: 2 } }]), 0)
  d.query({ t: 'create table', name: 'aside', cols: [{ name: 'x' }] })
  assertEquals(await cost([{ entity: { eid: 'c' }, product: { price: 3 } }]), 1)
})

// A Durable Object's SQLite binds at most 100 parameters per statement, so a
// write whose statements grow a parameter per entity fails at the 101st.
test('a batch past 100 entities binds under the Durable Object limit', async () => {
  let capped = spy(mem(), (_, params) => {
    if (params.length > 100) throw new Error('too many SQL variables')
  })
  // A declared rule over what the batch writes, so the batch is read as an
  // overlay (overlay.ts) as well as written.
  let ruled = loadVocab([...shop.docs, {
    $defs: { priced: { rule: true, match: '.product.price>1' } },
  }])
  let s = storage(capped, ruled, { number: true })
  s.install()
  let g = graph({ storage: s, vocab: ruled })
  let many = (price: number) =>
    Array.from({ length: 150 }, (_, i) => ({
      entity: { eid: `p${i}` },
      product: { price },
    }))
  await g.apply(many(1))
  await g.apply(many(2))
  assertEquals((s.read('.product.price=2') as Bundle[]).length, 150)
})

test('a batch writes each table in one statement, however many entities it gives', async () => {
  let written = async (n: number) => {
    let seen: string[] = []
    let s = storage(spy(mem(), (sql) => void seen.push(sql)), shop, {
      number: true,
    })
    s.install()
    s.raise()
    seen.length = 0
    let reviews = Array.from({ length: n }, (_, i) => ({
      entity: { eid: `r${i}` },
      review: { stars: i, product: `p${i}` },
    }))
    let products = Array.from({ length: n }, (_, i) => ({
      entity: { eid: `p${i}` },
      doc: { title: `Mug ${i}` },
      product: { price: i + 0.1 },
    }))
    let born = await write(s, [...reviews, ...products])
    assertEquals(
      born.map((e) => e.num),
      Array.from({ length: 2 * n }, (_, i) => i + 1),
    )
    assertEquals((s.read('.review') as Bundle[]).length, n)
    let [r, p] = s.get([`r${n - 1}`, `p${n - 1}`])
    assertEquals(c(r, 'review'), { stars: n - 1, product: `p${n - 1}` })
    assertEquals(c(p, 'product').price, n - 0.9)
    return seen.filter((q) => /^\s*insert/.test(q)).length
  }
  assertEquals(await written(150), await written(3))
})

test('a value written whole reads back as a bound value does', async () => {
  let s = store()
  let title = 'a\ud800b \u0000 😀'
  await write(s, [
    { entity: { eid: 'p1' }, doc: { title }, product: { price: 0.1 + 0.2 } },
    { entity: { eid: 'p2' }, doc: { title: 'x' } },
  ])
  await write(s, [{ entity: { eid: 'p2' }, doc: { title } }])
  let [p1, p2] = s.get(['p1', 'p2'])
  assertEquals(c(p1, 'doc').title, c(p2, 'doc').title)
  assertEquals(c(p1, 'product').price, 0.30000000000000004)
})

test("each entity's writes land in the order a batch gives them", async () => {
  let s = store()
  await write(s, [
    { entity: { eid: 'p1' }, product: { price: 1 }, doc: { title: 'a' } },
    { entity: { eid: 'p2' }, doc: { title: 'b' }, product: { price: 2 } },
    { entity: { eid: 'p1' }, product: null },
    { entity: { eid: 'p1' }, product: { price: 3 } },
    { entity: { eid: 'p2' }, doc: { title: 'c' } },
  ])
  let [p1, p2] = s.get(['p1', 'p2'])
  assertEquals([c(p1, 'product').price, c(p1, 'doc').title], [3, 'a'])
  assertEquals([c(p2, 'product').price, c(p2, 'doc').title], [2, 'c'])
  assertEquals((s.read('.product') as Bundle[]).length, 2)
})
