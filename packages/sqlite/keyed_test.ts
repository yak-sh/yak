import { assert, assertEquals } from '@std/assert'
import type { BindOpts } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { mem, seed, shop } from './harness.ts'
import { get, storage } from './mod.ts'

Deno.test('transaction keyed gather shares whole-set projections, observes writes and rollback', () => {
  let driver = mem()
  let opts: BindOpts = {
    derived: { 'doc.body': { tag: 'text', expr: () => "'hydrated body'" } },
  }
  let s = storage(driver, shop, opts)
  s.install()
  seed(s, [
    { entity: { eid: 'maker' }, doc: { title: 'Maker' } },
    {
      entity: { eid: 'product' },
      product: { price: 12, available: true, maker: 'maker' },
      doc: { title: 'Product' },
    },
  ])
  let before = get(driver, shop, ['product'], opts)
  assertEquals(s.tx((tx) => tx.get(['product'])), before)
  try {
    s.tx((tx) => {
      tx.patch([{ entity: { eid: 'product' }, product: { price: 20 } }])
      assertEquals(tx.get(['product']), get(driver, shop, ['product'], opts))
      tx.remove([{ eid: 'product' }])
      assertEquals(tx.get(['product']), get(driver, shop, ['product'], opts))
      throw new Error('rollback')
    })
  } catch (e) {
    assertEquals((e as Error).message, 'rollback')
  }
  assertEquals(s.tx((tx) => tx.get(['product'])), before)
  assertEquals(s.tx((tx) => tx.get(['absent'])), [])
  assertEquals(s.tx((tx) => tx.get([])), [])
  assertEquals(
    s.tx((tx) => tx.get(['maker', 'absent', 'product', 'maker'])),
    get(driver, shop, ['maker', 'absent', 'product', 'maker'], opts),
  )
})

Deno.test('singleton gather probes indexed owners, bounds wide vocab and retains real present columns', () => {
  let vocab = loadVocab({
    $defs: {
      entity: { type: 'object', wire: false },
      data: {
        type: 'object',
        properties: { present: { type: 'string' } },
      },
      ...Object.fromEntries(Array.from({ length: 405 }, (_, i) => [
        `tag${i}`,
        { type: 'object' },
      ])),
    },
  })
  let driver = mem()
  let queries: string[] = []
  let s = storage(
    {
      ...driver,
      query: (sql, params) => {
        queries.push(sql)
        return driver.query(sql, params)
      },
    },
    vocab,
    { number: false },
  )
  s.install()
  seed(s, [{
    entity: { eid: 'sparse' },
    data: { present: 'kept' },
    tag0: {},
    tag404: {},
  }])
  queries.length = 0
  assertEquals(s.tx((tx) => tx.get(['sparse'])), [{
    entity: { eid: 'sparse' },
    data: { present: 'kept' },
    tag0: {},
    tag404: {},
  }])
  assertEquals(queries.length, 6) // spine + two presence chunks + three facets
  assert(queries.every((sql) => !sql.includes('json_each')))
  assertEquals(queries.filter((sql) => sql.includes('union all')).length, 2)
  // A new facet is visible immediately: only SQL shapes are cached, not rows
  // or presence. An absent entity must not be cached across a later birth.
  seed(s, [{ entity: { eid: 'sparse' }, tag1: {} }])
  assertEquals(s.tx((tx) => tx.get(['sparse']))[0].tag1, {})
  assertEquals(s.tx((tx) => tx.get(['later'])), [])
  seed(s, [{ entity: { eid: 'later' }, tag1: {} }])
  assertEquals(s.tx((tx) => tx.get(['later']))[0].tag1, {})
})
