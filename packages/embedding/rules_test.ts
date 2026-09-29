// The rules facet: the vector table raised in the host's own database, and the
// `.near` compiler a host gets without wiring one up.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { parse } from '@yaks/query'
import { compile, tally } from '@yaks/sql'
import { extend, meaning, rules } from './rules.ts'
import { TABLE } from './ddl.ts'
import { mem, shop, stocked } from './testing.ts'

let hash = { embedder: { via: 'hash' } } as const

test('rules raises the vectors and adds no rule to apply()', () => {
  let sql = mem()
  assertEquals(rules({ sql }), [])
  assertEquals(tally(sql, TABLE), 0)
  // and it is idempotent, so a host that already had the table keeps it
  rules({ sql })
})

test('the extension a config builds answers .near over these vectors', async () => {
  let db = await stocked()
  let [near] = extend({ sql: db }, hash)
  let q = compile(parse('.near=book-1&.order=similar'), shop, {
    extend: [near],
  })
  assertEquals(db.query(q).map((r) => String(r.eid))[0], 'book-2')
})

test('the neighbourhood the config bounded is the one it gets', async () => {
  let db = await stocked()
  let [near] = extend({ sql: db }, { ...hash, neighbours: 1 })
  assertEquals(
    db.query(compile(parse('.near=book-1'), shop, { extend: [near] })).length,
    1,
  )
  let [strict] = extend({ sql: db }, { ...hash, floor: 0.99 })
  let tight = compile(parse('.near=book-1'), shop, { extend: [strict] })
  assertEquals(db.query(tight).length, 0)
})

test('no embedder named is no space to rank in, and no extension', () => {
  // The host still comes up: `.near` gets the compiler's own refusal, which is
  // the same answer a host that never composed this plugin gives.
  assertEquals(extend({ sql: mem() }, {}), [])
  assertThrows(
    () => compile(parse('.near=book-1'), shop, { extend: [] }),
    Error,
  )
})

test('a key that has not arrived still names the space it will fill', async () => {
  // Waiting for a key is the sweep's problem: what a query needs is the model
  // name, and the config says that whether or not the environment has a token.
  let db = await stocked()
  let [near] = extend({ sql: db }, {
    embedder: {
      via: 'ollama',
      model: 'hash-64',
      base: 'https://box',
      key: undefined,
    },
  })
  let q = compile(parse('.near=book-1&.order=similar'), shop, {
    extend: [near],
  })
  assertEquals(db.query(q).map((r) => String(r.eid))[0], 'book-2')
})

test('a phrase search sees an embedder that arrives after composition', async () => {
  let db = await stocked()
  let options: { embedder?: { via: 'hash' } } = {}
  let find = meaning({ sql: db, vocab: shop }, options)
  assertEquals(await find('dragon'), [])
  options.embedder = { via: 'hash' }
  assert((await find('dragon')).length > 0)
})
