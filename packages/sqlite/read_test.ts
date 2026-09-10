// Reads compile a query and gather whole entities: a filter selects, a
// reference reads back as the eid it points at, bare words require an extension,
// and an aggregate comes back as raw rows.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { Unsupported } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import type { Bundle, Comp } from './bundle.ts'
import { mem, seed, shop as vocab, store } from './harness.ts'

import { storage } from './mod.ts'

let c = (b: Bundle, name: string): Comp => b[name] as Comp
let eids = (bs: Bundle[]): string[] => bs.map((b) => b.entity.eid).sort()

Deno.test('a scalar filter selects the matching entities', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'p1' }, product: { price: 10 } },
    { entity: { eid: 'p2' }, product: { price: 20 } },
  ])
  assertEquals(eids(s.read('.price=10')), ['p1'])
  assertEquals(eids(s.read('.price>=15')), ['p2'])
})

Deno.test('a reference reads back as the target eid', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'm1' }, doc: { title: 'Acme' } },
    { entity: { eid: 'p1' }, product: { price: 5, maker: 'm1' } },
  ])
  assertEquals(c(s.read('.kind=product')[0], 'product').maker, 'm1')
})

Deno.test('a reference-deref path filters through the target', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'm1' }, doc: { title: 'Acme' } },
    { entity: { eid: 'p1' }, product: { price: 5, maker: 'm1' } },
    { entity: { eid: 'm2' }, doc: { title: 'Other' } },
    { entity: { eid: 'p2' }, product: { price: 6, maker: 'm2' } },
  ])
  assertEquals(eids(s.read('.product.maker.doc.title~=acme')), ['p1'])
})

Deno.test('a bare-word query requires an explicitly registered extension', () => {
  let s = store()
  assertThrows(() => s.read('mug'), Unsupported)
})

Deno.test('the kind scope selects the most specific kind', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'p1' }, doc: { title: 'Mug' }, product: { price: 1 } },
    { entity: { eid: 'd1' }, doc: { title: 'About' } },
  ])
  assertEquals(eids(s.read('.kind=product')), ['p1'])
  assertEquals(eids(s.read('.kind=doc')), ['d1'])
})

Deno.test('rows() hands back an aggregate shape verbatim', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'p1' }, product: { status: 'live' } },
    { entity: { eid: 'p2' }, product: { status: 'live' } },
    { entity: { eid: 'p3' }, product: { status: 'draft' } },
  ])
  assertEquals(Number(s.rows('.status=live&.count!')[0].n), 2)
})

Deno.test('the newest-first window pages a prefix', () => {
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

Deno.test('a gathered bundle carries the entity number storage minted', () => {
  let s = store()
  seed(s, [
    { entity: { eid: 'p1' }, product: { price: 1 } },
    { entity: { eid: 'p2' }, product: { price: 2 } },
  ])
  assertEquals(s.read('.price=2')[0].entity, { eid: 'p2', num: 2 })
})

Deno.test('whole-set gathers are bounded by vocabulary, not the 1000 entities; get preserves identity order', () => {
  let driver = mem()
  let queries = 0
  let s = storage({
    ...driver,
    query: (sql, params) => {
      queries++
      return driver.query(sql, params)
    },
  }, vocab)
  s.install()
  seed(
    s,
    Array.from({ length: 1000 }, (_, i) => ({
      entity: { eid: `bulk${i}` },
      product: { price: i },
      doc: { title: `item ${i}` },
    })),
  )
  queries = 0
  let all = s.read('.product')
  assertEquals(all.length, 1000)
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

Deno.test('wide sparse gathers cross owner and vocabulary chunks without stale occupancy', () => {
  let driver = mem()
  let vocab = loadVocab({
    $defs: {
      entity: { type: 'object', properties: { num: { type: 'number' } } },
      ...Object.fromEntries(
        Array.from({ length: 405 }, (_, i) => [`facet${i}`, {
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
  driver.exec(`with recursive n(x) as
    (values(1) union all select x+1 from n where x<4101)
    insert into entity(id,eid,num) select x, 'owner-'||x, x from n;
    insert into facet404(entity,value) values(4101,'last chunk')`)
  let ids = Array.from({ length: 4101 }, (_, i) => `owner-${i + 1}`)
  let fetched = s.tx((tx) => tx.get([...ids, 'absent', ids[0]]))
  assertEquals(fetched.map((b) => b.entity.eid), [...ids, ids[0]])
  assertEquals(fetched[0], { entity: { eid: ids[0], num: 1 } })
  assertEquals(fetched[4100].facet404, { value: 'last chunk' })
  // Another writer can fill or clear a table between reads. The empty-table
  // shortcut must be a live query, never a vocabulary/connection-wide cache.
  driver.exec("insert into facet0(entity,value) values(1,'newly populated')")
  assertEquals(s.tx((tx) => tx.get(ids.slice(0, 2)))[0].facet0, {
    value: 'newly populated',
  })
  driver.exec('delete from facet0')
  assertEquals(s.tx((tx) => tx.get(ids.slice(0, 2)))[0].facet0, undefined)
})
