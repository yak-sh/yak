import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import {
  as,
  by,
  col,
  eidOf,
  fn,
  insert,
  lit,
  scan,
  select,
  val,
} from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { get, storage } from './mod.ts'
import { mem, shop, spy, unit } from './testing.ts'
import { get as census } from './fixtures/census.ts'

let vocab = loadVocab([...shop.docs, archetypeDoc, {
  $defs: {
    marker: { component: true, type: 'object' },
    named: {
      component: true,
      type: 'object',
      properties: {
        maker: { type: 'string', ref: 'entity' },
        empty: { type: 'string' },
      },
    },
  },
}])

test('a warmed identity gather reads fresh ownership, shape, values and lifecycle', () => {
  let reads = 0
  let driver = spy(mem(), (sql) => {
    if (!unit(sql)) reads++
  })
  let s = storage(driver, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  let patch = (row: Record<string, unknown>) =>
    g.apply([{ entity: { eid: 'p' }, ...row }], { trusted: true })
  patch({
    doc: {},
    product: { price: 1, maker: 'one' },
    named: { maker: 'two' },
    marker: {},
  })
  let fresh = () => {
    let expected = census(driver, vocab, ['p'])
    assertEquals(get(driver, vocab, ['p']), expected)
    reads = 0
    assertEquals(get(driver, vocab, ['p']), expected)
    assertEquals(reads, 1)
    return expected[0]
  }
  fresh()
  patch({
    created: { by: 'two' },
    doc: { title: 'changed' },
    product: { price: 2 },
  })
  assertEquals(fresh().created, s.get(['p'], ['created'])[0].created)
  patch({ marker: null })
  assertEquals(fresh().marker, undefined)
  patch({ marker: {} })
  assertEquals(fresh().marker, {})
  let id = Number(scan(driver, 'entity', by({ eid: 'p' }), ['id'])[0].id)
  driver.query({
    t: 'update',
    table: 'product',
    set: { price: val(9) },
    where: by({ entity: id }),
  })
  assertEquals(fresh().product, {
    price: 9,
    available: null,
    maker: 'one',
    status: null,
    sku: null,
  })
  assertThrows(
    () =>
      s.tx((tx) => {
        tx.patch([{ entity: { eid: 'p' }, doc: { title: 'temporary' } }])
        assertEquals(get(driver, vocab, ['p'])[0].doc, {
          title: 'temporary',
          body: null,
        })
        throw Error('undo')
      }),
    Error,
    'undo',
  )
  assertEquals(fresh().doc, { title: 'changed', body: null })
  g.apply([{ entity: { eid: 'p' }, $delete: true }])
  assertEquals(fresh().tombstone, {})
  patch({ doc: { title: 'back' } })
  assertEquals(fresh().doc, { title: 'back', body: null })
  assertEquals(fresh().product, undefined)
})

test('a warmed gather follows raw schema edits and refuses malformed live descriptors', () => {
  let driver = mem(), s = storage(driver, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply([{ entity: { eid: 'p' }, doc: {}, marker: {} }])
  get(driver, vocab, ['p'])
  get(driver, vocab, ['p'])
  g.apply([{ entity: { eid: 'p' }, marker: null }])
  let expected = get(driver, vocab, ['p'])
  driver.query({ t: 'drop', kind: 'table', name: 'marker' })
  assertEquals(get(driver, vocab, ['p']), expected)
  let row = get(driver, vocab, ['p'])[0]
  let id = Number(
    scan(driver, 'entity', by({ eid: row.entity.archetype! }), ['id'])[0].id,
  )
  driver.query({
    t: 'update',
    table: 'archetype',
    set: { tables: val('broken') },
    where: by({ entity: id }),
  })
  assertThrows(() => get(driver, vocab, ['p']))
})

test('joined projections keep reference scopes, bound derived values and requested absence', () => {
  let driver = mem()
  let opts = {
    derived: {
      'doc.title': {
        tag: 'text' as const,
        expr: () => fn('coalesce', col('title', 'doc'), val('bound')),
      },
    },
  }
  let s = storage(driver, vocab, opts)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply([{
    entity: { eid: 'p' },
    doc: {},
    product: { maker: 'one' },
    named: { maker: 'two' },
  }])
  let names = ['doc', 'product', 'named', 'marker']
  let expected = s.get(['p'], names)
  assertEquals(expected[0].doc, { title: 'bound', body: null })
  assertEquals((expected[0].product as { maker: string }).maker, 'one')
  assertEquals(expected[0].named, { maker: 'two', empty: null })
  assertEquals(expected[0].marker, undefined)
  assertEquals(s.get(['p', 'missing', 'p'], names), [expected[0], expected[0]])
  assertEquals(s.get(['missing'], names), [])
  assertEquals(s.get(['p'], []), [{ entity: expected[0].entity }])
  assertEquals(s.get(['p']), census(driver, vocab, ['p'], opts))
  assertEquals(s.get(['p']), census(driver, vocab, ['p'], opts))
  // A different registry on the same connection has a different read plan.
  assertEquals(
    get(driver, vocab, ['p'], {
      derived: { 'doc.title': { tag: 'text', expr: () => lit('other') } },
    })[0].doc,
    { title: 'other', body: null },
  )
})

test('a selected identity reads backed rows that have no stored spine', () => {
  let v = loadVocab([...vocab.docs, {
    $defs: {
      receipt: {
        component: true,
        computed: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
    },
  }])
  let driver = mem(), s = storage(driver, v)
  s.install()
  let tag = '00000000000000000000000000000000'
  let opts = {
    backed: {
      receipt: {
        tag,
        rows: select({
          cols: [as(lit(1), 'entity'), as(lit('Paid'), 'title')],
        }),
      },
    },
  }
  let eid = eidOf(tag, 1)
  assertEquals(get(driver, v, [eid], opts, ['receipt']), [{
    entity: { eid },
    receipt: { title: 'Paid' },
  }])
  assertEquals(get(driver, v, [eid], opts, []), [{ entity: { eid } }])
})

test('an empty shape guess sees a later classified or unclassified birth', () => {
  let driver = mem(), s = storage(driver, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  let ids = ['classified', 'raw']
  assertEquals(get(driver, vocab, ids), [])
  assertEquals(get(driver, vocab, ids), [])
  g.apply([{ entity: { eid: ids[0] }, marker: {} }])
  driver.query(insert('entity', { eid: ids[1] }))
  let id = Number(scan(driver, 'entity', by({ eid: ids[1] }), ['id'])[0].id)
  driver.query(insert('doc', { entity: id, title: 'new' }))
  assertEquals(get(driver, vocab, ids), census(driver, vocab, ids))
  assertEquals(get(driver, vocab, ids), census(driver, vocab, ids))
})
