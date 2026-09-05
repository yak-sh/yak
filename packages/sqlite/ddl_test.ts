// The schema a vocabulary implies: one identity table, one graveyard, one table
// per component, and the doc view plus its search index.

import { assert, assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { schema } from './ddl.ts'
import { storage } from './mod.ts'
import type { Driver } from './driver.ts'
import { mem, shop } from './harness.ts'

let all = schema(shop).join('\n')

// The live shape of a table, in declaration order.
let cols = (d: Driver, table: string) =>
  d.query(`pragma table_info("${table}")`, []).map((r) => String(r.name))

Deno.test('the shop vocabulary loads with its kinds and death words', () => {
  assertEquals(shop.all.includes('product'), true)
  assertEquals(shop.deaths('cascade'), [['review', 'product']])
  assertEquals(shop.deaths('detach'), [['product', 'maker']])
  assertEquals(shop.deaths('release'), [['bookmark', 'of']])
})

Deno.test('the spine and the graveyard are always present', () => {
  assert(/create table if not exists entity \(/.test(all), all)
  assert(all.includes('create table if not exists tombstone'), all)
})

Deno.test('every component gets a table keyed by an entity owner', () => {
  for (let comp of ['doc', 'product', 'review', 'bookmark']) {
    assert(
      new RegExp(`create table if not exists "${comp}" \\(`).test(all),
      `${comp} table missing`,
    )
  }
  // The spine component is the identity table, not a component table.
  assert(!all.includes('create table if not exists "entity"'), all)
})

Deno.test('a reference column stores an integer with a foreign key', () => {
  // product.maker is a reference — an integer id pointing at the spine.
  assert(/"maker" integer references entity\(id\)/.test(all), all)
})

Deno.test('a boolean column takes integer affinity, a text column text', () => {
  assert(/"available" integer/.test(all), all)
  assert(/"title" text/.test(all), all)
  assert(/"price" real/.test(all), all)
})

Deno.test('a doc vocabulary gets a doc_value view and a full-text index', () => {
  assert(all.includes('create view if not exists doc_value'), all)
  assert(/using fts5\(\s*"title", "body"/.test(all), all)
  // The index reads a column back out of the view, never the table: that is
  // the one seam a resolved column can be applied at (`snippet`, `rebuild`).
  assert(all.includes(`content='doc_value', content_rowid='entity'`), all)
})

// A column whose stored value is not its own words — @yaks/blob swaps a body
// for its address. Both the view and the two trigger sides resolve it, or the
// index holds hashes and a search finds a body by its title alone.
Deno.test('a resolved doc column is read as text by the view and the triggers', () => {
  let resolved = schema(shop, {
    'doc.body': (stored) =>
      `(select "words" from "stash" where "k" = ${stored})`,
  }).join('\n')
  assert(resolved.includes(`"k" = "body") as "body"`), resolved)
  assert(resolved.includes(`"k" = new."body")`), resolved)
  assert(resolved.includes(`"k" = old."body")`), resolved)
  // The column that IS its own text is untouched, on both sides.
  assert(resolved.includes(`coalesce(new."title", '')`), resolved)
  // And the view still publishes every stored column, since @yaks/sql reads
  // whole `doc` rows through it.
  for (let col of ['"entity"', '"title" as "title"', 'as "body"']) {
    assert(resolved.includes(col), col)
  }
})

Deno.test('the statements list in dependency order — spine first', () => {
  let stmts = schema(shop)
  assertEquals(stmts[0].includes('create table if not exists entity ('), true)
})

Deno.test('a column marked unique gets a unique index named after it', () => {
  assert(
    all.includes(
      'create unique index if not exists product_sku on "product" ("sku")',
    ),
    all,
  )
})

Deno.test('a component declares its composite unique and its index', () => {
  assert(
    all.includes(
      'create unique index if not exists shelf_aisle_slot ' +
        'on "shelf" ("aisle", "slot")',
    ),
    all,
  )
  assert(
    all.includes(
      'create index if not exists shelf_aisle_height ' +
        'on "shelf" ("aisle", "height")',
    ),
    all,
  )
})

Deno.test('an index comes after the table it covers', () => {
  let stmts = schema(shop)
  let table = stmts.findIndex((s) => s.includes('exists "shelf"'))
  let index = stmts.findIndex((s) => s.includes('shelf_aisle_slot'))
  assert(table >= 0 && index > table, `${table} ${index}`)
})

// A vocabulary that GREW: `create table if not exists` is silent about a table
// that is already there, so a column added to a word has to arrive by
// `alter table` or every read naming it fails at the engine.
Deno.test('a column a component grew is added to the live table', () => {
  let spine = { type: 'object', wire: false, properties: {} } as const
  let text = { type: 'string' } as const
  let d = mem()
  let was = loadVocab({
    $defs: {
      entity: spine,
      book: { type: 'object', properties: { title: text } },
    },
  })
  let now = loadVocab({
    $defs: {
      entity: spine,
      book: {
        type: 'object',
        properties: {
          title: text,
          isbn: text,
          of: { type: 'string', ref: 'entity', death: 'detach' },
        },
      },
    },
  })
  storage(d, was).install()
  assertEquals(cols(d, 'book'), ['entity', 'title'])
  // The grown vocabulary over the SAME database: the two new columns arrive,
  // the reference carrying its foreign key, and nothing already there moves.
  let grew = storage(d, now)
  grew.install()
  assertEquals(cols(d, 'book'), ['entity', 'title', 'isbn', 'of'])
  // And a wake under a vocabulary the tables already match adds nothing.
  assertEquals(grew.grown(), [])
})
