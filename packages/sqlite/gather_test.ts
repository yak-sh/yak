import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type BindOpts, insert, lit } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { mem, seed, shop, spy, unit } from './testing.ts'
import { get, storage } from './mod.ts'

test('transaction gather observes writes and rollback', () => {
  let driver = mem()
  let opts: BindOpts = {
    derived: { 'doc.body': { tag: 'text', expr: () => lit('hydrated body') } },
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

test('singleton gather reads a wide sparse vocabulary in one probe', () => {
  let vocab = loadVocab({
    $defs: {
      entity: {
        component: true,
        type: 'object',
        wire: false,
      },
      data: {
        component: true,
        type: 'object',
        properties: { present: { type: 'string' } },
      },
      ...Object.fromEntries(Array.from({ length: 405 }, (_, i) => [
        `tag${i}`,
        { component: true, type: 'object' },
      ])),
    },
  })
  let queries: string[] = []
  let s = storage(
    spy(mem(), (sql) => void (unit(sql) || queries.push(sql))),
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
  assertEquals(queries.length, 5) // spine + presence + three facets
  // A new facet is visible immediately: only SQL shapes are cached, not rows
  // or presence. An absent entity must not be cached across a later birth.
  seed(s, [{ entity: { eid: 'sparse' }, tag1: {} }])
  assertEquals(s.tx((tx) => tx.get(['sparse']))[0].tag1, {})
  assertEquals(s.tx((tx) => tx.get(['later'])), [])
  seed(s, [{ entity: { eid: 'later' }, tag1: {} }])
  assertEquals(s.tx((tx) => tx.get(['later']))[0].tag1, {})
})

test('projected identities read only named facets and preserve projection/rollback truth', () => {
  let driver = mem()
  let queries: string[] = []
  let opts: BindOpts = {
    derived: { 'doc.body': { tag: 'text', expr: () => lit('hydrated') } },
  }
  let s = storage(
    spy(driver, (sql) => void (unit(sql) || queries.push(sql))),
    shop,
    opts,
  )
  s.install()
  seed(s, [
    { entity: { eid: 'maker' }, doc: { title: 'Maker' } },
    {
      entity: { eid: 'p' },
      product: { price: 2, maker: 'maker', available: true },
      doc: { title: 'Product' },
    },
  ])
  let whole = s.tx((tx) => tx.get(['p']))[0]
  queries.length = 0
  assertEquals(s.tx((tx) => tx.get(['p'], ['product'])), [{
    entity: whole.entity,
    product: whole.product,
  }])
  assertEquals(queries.length, 2)
  assertEquals(s.tx((tx) => tx.get(['p'], ['doc']))[0].doc, whole.doc)
  assertEquals(s.tx((tx) => tx.get(['p'], ['review']))[0].review, undefined)
  assertEquals(s.tx((tx) => tx.get(['absent'], ['doc'])), [])
  try {
    s.tx((tx) => {
      tx.patch([{ entity: { eid: 'p' }, product: { price: 9 } }])
      assertEquals(
        (tx.get(['p'], ['product'])[0].product as { price: number }).price,
        9,
      )
      tx.remove([{ eid: 'p' }])
      assertEquals(tx.get(['p'], []), tx.get(['p']))
      throw Error('rollback')
    })
  } catch (e) {
    assertEquals((e as Error).message, 'rollback')
  }
  assertEquals(
    s.tx((tx) => tx.get(['p'], ['product']))[0].product,
    whole.product,
  )
})

test('whole reads scale with worn components across one or 100 hits', () => {
  let name = (i: number) =>
    `facet${String.fromCharCode(97 + Math.floor(i / 26))}${
      String.fromCharCode(97 + i % 26)
    }`
  let first = name(0)
  let last = name(39)
  let vocab = loadVocab({
    $defs: {
      entity: { component: true, type: 'object', wire: false },
      ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [
        name(i),
        { component: true, type: 'object' },
      ])),
    },
  })
  let queries: string[] = []
  let driver = spy(
    { ...mem(), arms: undefined },
    (sql) => void (unit(sql) || queries.push(sql)),
  )
  let s = storage(driver, vocab, { number: false })
  s.install()
  let ids = Array.from({ length: 100 }, (_, i) => `owner-${i}`)
  driver.query(insert(
    'entity',
    ...ids.map((eid, i) => ({
      id: i + 1,
      eid,
    })),
  ))
  driver.query(insert(first, ...ids.map((_, i) => ({ entity: i + 1 }))))
  driver.query(insert(last, { entity: 1 }))

  queries.length = 0
  assertEquals(s.read(`.${first}`).length, 100)
  assertEquals(queries.length, 5) // filter + spine + probe + two facets
  queries.length = 0
  assertEquals(s.get(['owner-0'])[0][last], {})
  assertEquals(queries.length, 4) // spine + probe + two facets
  queries.length = 0
  assertEquals(s.read(`.${first}`, {}, [first]).length, 100)
  assertEquals(queries.length, 3) // filter + spine + named facet
  assert(queries.every((sql) => !sql.includes(last)))
})
