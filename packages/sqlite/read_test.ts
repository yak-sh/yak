// Reads compile a query and gather whole entities: a filter selects, a
// reference reads back as the eid it points at, bare words require an extension,
// and an aggregate comes back as raw rows.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { gather } from '@yaks/graph'
import { and, eq, or } from '@yaks/query'
import { ARMS, insert, Unsupported } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import type { Bundle, Comp } from './bundle.ts'
import { mem, seed, shop as vocab, spy, store } from './testing.ts'

import { storage } from './mod.ts'

let c = (b: Bundle, name: string): Comp => b[name] as Comp
let eids = (bs: Bundle[]): string[] => bs.map((b) => b.entity.eid).sort()

test('a scalar filter selects the matching entities', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'p1' }, product: { price: 10 } },
    { entity: { eid: 'p2' }, product: { price: 20 } },
  ])
  assertEquals(eids(s.read('.price=10')), ['p1'])
  assertEquals(eids(s.read('.price>=15')), ['p2'])
})

// A Durable Object's SQLite binds at most 100 parameters per statement, and an
// any-of list is as long as its caller made it.
test('an any-of list past 100 values binds under the Durable Object limit', () => {
  let s = storage(
    spy(mem(), (_, params) => {
      if (params.length > 100) throw new Error('too many SQL variables')
    }),
    vocab,
  )
  s.install()
  seed(s, [
    { entity: { eid: 'p1' }, product: { price: 1 } },
    { entity: { eid: 'p2' }, product: { price: 2 } },
    { entity: { eid: 'p3' }, product: { price: 3 } },
  ])
  let many = Array.from({ length: 150 }, (_, i) => i + 10).join(',')
  assertEquals(eids(s.read(`.price=3,x,1,${many}`)), ['p1', 'p3'])
})

test('a reference reads back as the target eid', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'm1' }, doc: { title: 'Acme' } },
    { entity: { eid: 'p1' }, product: { price: 5, maker: 'm1' } },
  ])
  assertEquals(c(s.read('.kind=product')[0], 'product').maker, 'm1')
  assertEquals(eids(s.read('.product.maker')), ['p1'])
})

test('a reference-deref path filters through the target', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'm1' }, doc: { title: 'Acme' } },
    { entity: { eid: 'p1' }, product: { price: 5, maker: 'm1' } },
    { entity: { eid: 'm2' }, doc: { title: 'Other' } },
    { entity: { eid: 'p2' }, product: { price: 6, maker: 'm2' } },
  ])
  assertEquals(eids(s.read('.product.maker.doc.title~=acme')), ['p1'])
})

test('a reverse child property presence tests the child', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'p1' }, product: { price: 1 } },
    { entity: { eid: 'p2' }, product: { price: 2 } },
    { entity: { eid: 'r1' }, review: { product: 'p1' }, doc: { title: 'A' } },
    { entity: { eid: 'r2' }, review: { product: 'p2' }, doc: {} },
  ])
  assertEquals(eids(s.read('.reviews.title')), ['p1'])
})

test('a bare-word query requires an explicitly registered extension', () => {
  let s = store()
  assertThrows(() => s.read('mug'), Unsupported)
})

test('the kind scope selects the most specific kind', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'p1' }, doc: { title: 'Mug' }, product: { price: 1 } },
    { entity: { eid: 'd1' }, doc: { title: 'About' } },
  ])
  assertEquals(eids(s.read('.kind=product')), ['p1'])
  assertEquals(eids(s.read('.kind=doc')), ['d1'])
})

test('rows() hands back an aggregate shape verbatim', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'p1' }, product: { status: 'live' } },
    { entity: { eid: 'p2' }, product: { status: 'live' } },
    { entity: { eid: 'p3' }, product: { status: 'draft' } },
  ])
  assertEquals(Number(s.rows('.status=live&.count')[0].n), 2)
})

test('the newest-first window pages a prefix', () => {
  let s = store()
  seed(s, [
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

test('a gathered bundle carries the entity number storage minted', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'p1' }, product: { price: 1 } },
    { entity: { eid: 'p2' }, product: { price: 2 } },
  ])
  assertEquals(s.read('.price=2')[0].entity, { eid: 'p2', num: 2 })
})

test('whole-set gathers are bounded by vocabulary, not the 100 entities; get preserves identity order', () => {
  let queries = 0
  let s = storage(spy(mem(), () => void queries++), vocab)
  s.install()
  seed(
    s,
    Array.from({ length: 100 }, (_, i) => ({
      entity: { eid: `bulk${i}` },
      product: { price: i },
      doc: { title: `item ${i}` },
    })),
  )
  queries = 0
  let all = s.read('.product')
  assertEquals(all.length, 100)
  assert(queries <= vocab.all.length + 1, `query count ${queries}`)
  let ids = all.map((b) => b.entity.eid).reverse()
  let fetched = s.tx((tx) => tx.get([...ids, 'absent', ids[0]]))
  assertEquals(fetched.map((b) => b.entity.eid), [...ids, ids[0]])
  assertEquals(c(fetched[0], 'doc'), c(all.at(-1)!, 'doc'))
  s.tx((tx) => tx.remove([all[0].entity]))
  let dead = s.tx((tx) => tx.get([all[0].entity.eid]))[0]
  assertEquals(dead.tombstone, {})
  assertEquals(dead.product, undefined)
})

test('wide sparse gathers cross owner and vocabulary chunks without stale occupancy', () => {
  let driver = mem()
  let vocab = loadVocab({
    $defs: {
      entity: {
        component: true,
        type: 'object',
        properties: { num: { type: 'number' } },
      },
      ...Object.fromEntries(
        Array.from({ length: 405 }, (_, i) => [`facet${i}`, {
          component: true,
          type: 'object',
          properties: { value: { type: 'string' } },
        }]),
      ),
    },
  })
  let s = storage(driver, vocab)
  s.install()
  // Raw setup keeps this test about reads, not 4101 write pipelines. Most
  // tables stay empty, one has a row beyond the first 4096-owner chunk.
  let ids = Array.from({ length: 4101 }, (_, i) => `owner-${i + 1}`)
  driver.query(
    insert('entity', ...ids.map((eid, i) => ({ id: i + 1, eid, num: i + 1 }))),
  )
  driver.query(insert('facet404', { entity: 4101, value: 'last chunk' }))
  let fetched = s.tx((tx) => tx.get([...ids, 'absent', ids[0]]))
  assertEquals(fetched.map((b) => b.entity.eid), [...ids, ids[0]])
  assertEquals(fetched[0], { entity: { eid: ids[0], num: 1 } })
  assertEquals(fetched[4100].facet404, { value: 'last chunk' })
  // Another writer can fill or clear a table between reads. The empty-table
  // shortcut must be a live query, never a vocabulary/connection-wide cache.
  driver.query(insert('facet0', { entity: 1, value: 'newly populated' }))
  assertEquals(s.tx((tx) => tx.get(ids.slice(0, 2)))[0].facet0, {
    value: 'newly populated',
  })
  driver.query({ t: 'delete', from: 'facet0' })
  assertEquals(s.tx((tx) => tx.get(ids.slice(0, 2)))[0].facet0, undefined)
})

test('numeric gather ownership stays internal; present is an ordinary property', () => {
  let driver = mem()
  let vocab = loadVocab({
    $defs: {
      entity: {
        component: true,
        type: 'object',
        properties: { num: { type: 'number' } },
      },
      sample: {
        component: true,
        type: 'object',
        properties: { present: { type: 'string' } },
      },
      marker: {
        component: true,
        type: 'object',
        properties: {},
      },
    },
  })
  let s = storage(driver, vocab)
  s.install()
  driver.query(insert('entity', { id: 47, eid: 'not-a-storage-id', num: 9 }))
  driver.query(insert('sample', { entity: 47, present: 'stored' }))
  driver.query(insert('marker', { entity: 47 }))
  assertEquals(s.read('.sample'), [{
    entity: { eid: 'not-a-storage-id', num: 9 },
    marker: {},
    sample: { present: 'stored' },
  }])
})

// A store whose vocabulary never loaded @yaks/id says nothing about numbers,
// including the ones its own column still holds — an app numbered before the
// plugin was opt in (T-37831). One shape: what the vocabulary declares is what
// a row comes back wearing, so the same store cannot answer a number for an
// old row and none for a new one.
test('a store with no number in its vocabulary shows none it has', () => {
  let driver = mem()
  let vocab = loadVocab({
    $defs: {
      entity: { component: true, type: 'object', wire: false },
      sample: {
        component: true,
        type: 'object',
        properties: { present: { type: 'string' } },
      },
    },
  })
  let s = storage(driver, vocab)
  s.install()
  driver.query(insert('entity', { id: 47, eid: 'was-numbered', num: 9 }))
  driver.query(insert('sample', { entity: 47, present: 'stored' }))
  assertEquals(s.read('.sample'), [{
    entity: { eid: 'was-numbered' },
    sample: { present: 'stored' },
  }])
  // The identity read of one entity is the same answer.
  assertEquals(s.tx((tx) => tx.get(['was-numbered']))[0].entity, {
    eid: 'was-numbered',
  })
})

test('a wide gather avoids compound SELECT limits', () => {
  // Workerd refuses a sixth compound SELECT arm. Presence is one VALUES
  // statement even on a driver that reports no compound width.
  let asked: string[] = []
  let driver = spy({ ...mem(), arms: undefined }, (sql) => void asked.push(sql))
  let vocab = loadVocab({
    $defs: {
      entity: {
        component: true,
        type: 'object',
        wire: false,
        // Numbered, since the store below mints numbers: a spine that does not
        // declare the property does not show one (read.ts `numbered`).
        properties: { num: { type: 'number', stamped: true } },
      },
      ...Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`facet${i}`, {
          component: true,
          type: 'object',
          properties: { value: { type: 'string' } },
        }]),
      ),
    },
  })
  let s = storage(driver, vocab, { number: true })
  s.install()
  seed(s, [
    {
      entity: { eid: 'a' },
      facet0: { value: 'first' },
      facet19: { value: 'last' },
    },
    { entity: { eid: 'b' }, facet7: { value: 'middle' } },
  ])
  asked.length = 0
  // One or several eids take the same set gather.
  assertEquals(s.tx((tx) => tx.get(['a'])), [{
    entity: { eid: 'a', num: 1 },
    facet0: { value: 'first' },
    facet19: { value: 'last' },
  }])
  assertEquals(s.tx((tx) => tx.get(['a', 'b'])).map((b) => b.entity.eid), [
    'a',
    'b',
  ])
  assertEquals(s.tx((tx) => tx.get(['a', 'b']))[1].facet7, { value: 'middle' })
  for (let sql of asked) {
    let terms = sql.split(/\bunion\b/i).length
    assert(terms <= ARMS, `${terms} compound terms:\n${sql}`)
  }
})

test('a reverse read binds one value per property, however many it asks about', async () => {
  // A Durable Object's SQLite binds 100 values a statement and refuses the
  // 101st, which is what erasing a space met: the gather's read of everything
  // pointing at what a delete took bound one per property per entity.
  let cap = Infinity
  let s = storage(
    spy(
      mem(),
      (sql, params) =>
        assert(params.length <= cap, `${params.length} values bound:\n${sql}`),
    ),
    vocab,
  )
  s.install()
  let makers = Array.from({ length: 21 }, (_, i) => `m${i}`)
  seed(s, [
    ...makers.map((eid) => ({ entity: { eid }, doc: { title: eid } })),
    { entity: { eid: 'p1' }, product: { price: 5, maker: 'm20' } },
  ])
  cap = 100
  let snap = await s.tx((tx) => gather(tx, vocab, [{ about: makers }]))
  assertEquals(eids(snap.near.get('product.maker m20')!), ['p1'])
  assertEquals(snap.near.get('product.maker m0'), [])
})

test('a disjunction longer than SQLite nests expressions reads', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'm1' }, doc: { title: 'Acme' } },
    { entity: { eid: 'p1' }, product: { price: 5, maker: 'm1' } },
  ])
  // SQLite refuses an expression tree deeper than 1000. A list of values is
  // one bound array; a disjunction over the entity table alone stays one
  // boolean tree, as long as the list of alternatives.
  let makers = Array.from({ length: 1001 }, (_, i) => `m${i}`)
  assertEquals(eids(s.read(`.maker=${makers}`)), ['p1'])
  let any = or(...makers.map((m) => eq('eid', m)))
  assertEquals(eids(s.read(and(any))), ['m1'])
})
