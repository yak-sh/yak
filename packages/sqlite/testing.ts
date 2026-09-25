// Shared test fixtures (not part of the published package — see deno.json): an
// in-memory SQLite driver (./db.ts `open`), and a small made-up vocabulary
// the test files write against. The domain is a tiny shop — documents,
// products, reviews, makers, bookmarks, shelves — chosen so it exercises every
// declared reference death behavior (a review cascades with its product, a
// product detaches from a deleted maker, a bookmark is released) and both index
// forms (a product's unique sku, a shelf's composite slot) without any
// knowledge outside this file.

import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { open } from './db.ts'
import { prepared } from './native.ts'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import {
  type Column,
  type CreateTable,
  type Driver,
  insert,
  type Param,
  render,
  type Row,
} from '@yaks/sql'
import { storage, type Store } from './mod.ts'

// A Driver over a fresh in-memory database, foreign keys enforced so a dangling
// reference is rejected the way it would be in production.
export let mem = (): Driver => open(':memory:')

/**
 * An in-memory database that takes text, for a stand-in imitating an engine
 * whose own API is text: a Durable Object's `sql.exec`, D1's `prepare`. Only a
 * stand-in needs this door, and nothing published has one: @yaks/sqlite runs
 * what @yaks/sql renders. Keys are enforced, as `open()` enforces them.
 */
export let textual = () => {
  let db = new Database(':memory:')
  let run = prepared(db)
  let keys = render({ t: 'pragma', name: 'foreign_keys', value: 'on' })
  run(keys.sql, keys.params)
  return { run, close: () => db.close() }
}

// The shop vocabulary, authored as JSON Schema plus the yaks keywords.
let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A named thing: a title and a body of text.
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    // Something for sale: a price, a state, and the maker who made it. Deleting
    // a maker detaches the product (the property is nulled), never deletes it.
    product: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        // The stock number, which no two products share — the property's own
        // `unique`, and what a duplicate insert is refused by.
        sku: { type: 'string', unique: true },
        price: { type: 'number' },
        available: { type: 'boolean' },
        status: { type: 'string', enum: ['draft', 'live', 'sold'] },
        maker: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    // Where a product sits on the floor: one product per slot, and an aisle
    // read by the shelf order. The composite index, declared on the
    // component.
    shelf: {
      component: true,
      type: 'object',
      unique: [['aisle', 'slot']],
      index: [['aisle', 'height']],
      properties: {
        aisle: { type: 'string' },
        slot: { type: 'number' },
        height: { type: 'number' },
      },
    },
    // A review exists about a product — deleting the product takes its reviews
    // with it (cascade).
    review: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        stars: { type: 'number' },
        product: { type: 'string', ref: 'product', death: 'cascade' },
      },
    },
    // A bookmark is a reference: the row's whole reason to exist is to point at
    // something, so deleting the target releases the row (the owner survives).
    bookmark: {
      component: true,
      type: 'object',
      properties: {
        of: { type: 'string', ref: 'entity', death: 'release' },
      },
    },
    // Provenance: server-owned, so the graph's stamp phase is their only
    // writer.
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

export let shop: Vocab = loadVocab(doc)

// A recipe whose properties hold JSON values beside a plain one: an object, an
// array, and a union that may be a string — the case a driver parsing JSON
// itself would get wrong (./jsonb.ts) — and booleans, which SQLite holds as
// 0/1. Every SQLite-shaped adapter's tests write the same {@link RECIPE}
// through it.
export let kitchen: Vocab = loadVocab({
  $defs: {
    recipe: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string' },
        meta: { type: 'object', properties: { oven: { type: 'number' } } },
        tags: { type: 'array', items: { type: 'string' } },
        any: { type: ['string', 'number', 'object'] },
        baked: { type: 'boolean' },
        vegan: { type: 'boolean' },
      },
    },
  },
})

export let RECIPE = {
  title: 'Cake',
  meta: { oven: 180, steps: [{ mix: true }] },
  tags: ['sweet', 'baked'],
  any: '"quoted"',
  baked: true,
  vegan: false,
}

// {@link RECIPE}'s booleans asked for as a `.fields` projection, and the row
// every SQLite-shaped adapter's `rows()` answers with once r1 holds it: the
// same `true`/`false` a component read returns, never the 0/1 stored.
export let PROJECTED = '.recipe&.fields=recipe.baked,recipe.vegan'
export let PROJECTED_ROW = {
  eid: 'r1',
  'recipe.baked': true,
  'recipe.vegan': false,
}

// A ready store over a fresh in-memory database with the schema installed.
// The shop numbers its entities: they are things a person refers to by number,
// so the tests over it see the human-readable numbering an application opts
// into.
export let store = (): Store => {
  let s = storage(mem(), shop, { number: true })
  s.install()
  return s
}

// Bundles written straight in, for a test that just needs data to read back.
export let seed = (s: Store, bundles: Bundle[]): void => {
  s.tx((tx) => tx.patch(bundles))
}

// A @yaks/graph over that store: the whole stack, which is how an application
// uses this package (the adapter owns the bytes, the graph owns the rules).
export let shopGraph = (): Graph => graph({ storage: store(), vocab: shop })

// A statement as SQLite receives it: its text and the values it binds.
/** Whether a statement opens, closes or marks a unit (unit.ts) rather than
 * reading or writing. */
export let unit = (sql: string): boolean =>
  /^(begin|savepoint|release|rollback|commit)\b/.test(sql)

/**
 * `d`, showing `saw` the text and bound values of each statement before it
 * runs. Rows `saw` returns answer in the statement's place, and whatever it
 * throws refuses the statement.
 */
export let spy = (
  d: Driver,
  saw: (sql: string, params: Param[]) => Row[] | void,
): Driver => ({
  ...d,
  query: (s) => {
    let r = render(s)
    return saw(r.sql, r.params) ?? d.query(s)
  },
})

/** A table written out by hand, as a storage adapter would raise it: for a
 * package that works beside the tables and does not create them. */
export let raised = (name: string, ...cols: Column[]): CreateTable => ({
  t: 'create table',
  name,
  cols,
})
let SPINE_REF = { table: 'entity', cols: ['id'] }
/** The column a component's table is keyed by: its owner's id. */
export let owner: Column = {
  name: 'entity',
  type: 'integer',
  pk: true,
  ref: SPINE_REF,
}
export let text = (name: string): Column => ({ name, type: 'text' })
export let SPINE = raised(
  'entity',
  { name: 'id', type: 'integer', pk: true },
  { name: 'eid', type: 'text', notNull: true, unique: true },
  { name: 'num', type: 'integer' },
)
export let TOMBSTONE = raised('tombstone', owner, {
  name: 'deleted_at',
  type: 'text',
  notNull: true,
})
/** A bookshop's tables: books with a title, a blurb and a price, and reviews
 * with prose of their own. */
export let BOOKSHOP: CreateTable[] = [
  SPINE,
  TOMBSTONE,
  raised('book', owner, text('title'), text('blurb'), {
    name: 'price',
    type: 'real',
  }),
  raised('review', owner, text('prose'), { name: 'stars', type: 'real' }, {
    name: 'book',
    type: 'integer',
    ref: SPINE_REF,
  }),
]
/** An entity's spine row, numbered by its id. */
export let entity = (db: Driver, id: number, eid: string) =>
  db.query(insert('entity', { id, eid, num: id }))
/** An entity laid to rest. */
export let bury = (db: Driver, entity: number, at = '2026-01-01T00:00:00Z') =>
  db.query(insert('tombstone', { entity, deleted_at: at }))
