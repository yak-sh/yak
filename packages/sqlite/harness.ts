// Shared test fixtures (not part of the published package — see deno.json): an
// in-memory SQLite driver over jsr:@db/sqlite, and a small made-up vocabulary
// the test files write against. The domain is a tiny shop — documents,
// products, reviews, makers, bookmarks, shelves — chosen so it exercises every
// declared reference death behavior (a review cascades with its product, a
// product detaches from a deleted maker, a bookmark is released) and both index
// forms (a product's unique sku, a shelf's composite slot) without any
// knowledge outside this file.

import { Database } from './db.ts'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { STOCK } from '@yaks/sql'
import type { Driver } from './driver.ts'
import { storage, type Store } from './mod.ts'

// A Driver over a fresh in-memory database, foreign keys enforced so a dangling
// reference is rejected the way it would be in production.
export let mem = (): Driver => {
  let db = new Database(':memory:')
  db.exec('pragma foreign_keys = on')
  return {
    query: (sql, params) => db.prepare(sql).all(...params),
    exec: (sql) => db.exec(sql),
    arms: STOCK,
  }
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
// itself would get wrong (./jsonb.ts). Every SQLite-shaped adapter's tests
// write the same {@link RECIPE} through it.
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
      },
    },
  },
})

export let RECIPE = {
  title: 'Cake',
  meta: { oven: 180, steps: [{ mix: true }] },
  tags: ['sweet', 'baked'],
  any: '"quoted"',
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
