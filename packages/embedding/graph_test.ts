// The graph facet: the vector table a writing host adds to its database, and the
// `.near` compiler a host gets without wiring one up.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { parse } from '@yaks/query'
import { compile, screen as compileScreen, tally } from '@yaks/sql'
import { add } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { extend, meaning, plugins, schema } from './graph.ts'
import { TABLE } from './ddl.ts'
import { mem, none, shop, stocked } from './testing.ts'

let hash = { embedder: { provider: 'hash' } }

test('the schema raises the vectors, and plugins add no rule to apply()', () => {
  let sql = open(':memory:')
  add(sql, schema())
  assertEquals(plugins(), [])
  assertEquals(tally(sql, TABLE), 0)
  // Adding it again changes nothing.
  add(sql, schema())
})

test('the extension a config builds answers .near over these vectors', async () => {
  let db = await stocked()
  let [near] = extend({ storage: { statements: db } }, hash)
  let q = compile(parse('.near=book-1&.order=similar'), shop, {
    extend: [near],
  })
  assertEquals(db.query(q).map((r) => String(r.eid))[0], 'book-2')
})

test('the neighbourhood the config bounded is the one it gets', async () => {
  let db = await stocked()
  let [near] = extend({ storage: { statements: db } }, {
    ...hash,
    neighbours: 1,
  })
  assertEquals(
    db.query(compile(parse('.near=book-1'), shop, { extend: [near] })).length,
    1,
  )
  let [strict] = extend({ storage: { statements: db } }, {
    ...hash,
    floor: 0.99,
  })
  let tight = compile(parse('.near=book-1'), shop, { extend: [strict] })
  assertEquals(db.query(tight).length, 0)
})

test('no embedder named is no space to rank in, and no extension', () => {
  // The host still comes up: `.near` gets the compiler's own refusal, which is
  // the same answer a host that never composed this plugin gives.
  assertEquals(extend({ storage: { statements: mem() } }, {}), [])
  assertThrows(
    () => compile(parse('.near=book-1'), shop, { extend: [] }),
    Error,
  )
})

test('a key that has not arrived still names the space it will fill', async () => {
  // Waiting for a key is the sweep's problem: what a query needs is the model
  // name, and the config says that whether or not the environment has a token.
  let db = await stocked()
  let [near] = extend({ storage: { statements: db } }, {
    embedder: { provider: 'gpu', model: 'hash-64', key: undefined },
  })
  let q = compile(parse('.near=book-1&.order=similar'), shop, {
    extend: [near],
  })
  assertEquals(db.query(q).map((r) => String(r.eid))[0], 'book-2')
})

test('a phrase search sees an embedder that arrives after composition', async () => {
  let db = await stocked()
  let options: { embedder?: { provider: string } } = {}
  let find = meaning(
    { storage: { statements: db }, vocab: shop, graph: none },
    options,
  )
  assertEquals(await find('dragon'), [])
  options.embedder = { provider: 'hash' }
  assert((await find('dragon')).length > 0)
})

test('a phrase search ranks only among what a filter line admits', async () => {
  let db = await stocked()
  let screen = (q: string) => compileScreen(parse(q), shop)
  let find = meaning(
    { storage: { statements: db, screen }, vocab: shop, graph: none },
    hash,
  )
  let ranked = async (within?: string) =>
    (await find('dragon burglar', { within })).map((h) => h.entity)
  assertEquals((await ranked()).length, 4)
  assertEquals(await ranked('.book.price>15'), ['book-2'])
  await assertRejects(
    () =>
      meaning({ storage: { statements: db }, vocab: shop, graph: none }, hash)(
        'dragon',
        { within: '.book' },
      ),
    Error,
    'cannot narrow',
  )
})

test('SQL facets reject storage without a statement capability', () => {
  assertThrows(() => extend({ storage: {} }, hash), Error, 'no SQL statements')
  assertThrows(
    () => meaning({ storage: {}, vocab: shop, graph: none }),
    Error,
    'no SQL statements',
  )
})
