// Shared test fixtures (not part of the published package — see deno.json): an
// in-memory SQLite driver over jsr:@db/sqlite, and a small made-up vocabulary
// the test files write against. The domain is a tiny shop — documents,
// products, reviews, makers, bookmarks, shelves — chosen so it exercises every
// reference death word (a review cascades with its product, a product detaches
// from a deleted maker, a bookmark is released) and both index spellings (a
// product's unique sku, a shelf's composite slot) without any knowledge outside
// this file.

import { Database } from '@db/sqlite'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import type { Driver } from './driver.ts'
import { storage, type Store } from './mod.ts'

// A Driver over a fresh in-memory database, foreign keys enforced so a dangling
// reference is refused the way it would be in production.
export let mem = (): Driver => {
  let db = new Database(':memory:')
  db.exec('pragma foreign_keys = on')
  return {
    query: (sql, params) => db.prepare(sql).all(...params),
    exec: (sql) => db.exec(sql),
  }
}

// The shop vocabulary, authored as JSON Schema plus the yaks keywords.
let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A named thing: a title and a body of text.
    doc: {
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    // Something for sale: a price, a state, and the maker who made it. Deleting
    // a maker detaches the product (the column is nulled), never deletes it.
    product: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        // The stock number, which no two products share — the column's own
        // `unique`, and what a duplicate insert is refused by.
        sku: { type: 'string', unique: true },
        price: { type: 'number' },
        available: { type: 'boolean' },
        status: { enum: ['draft', 'live', 'sold'] },
        maker: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    // Where a product sits on the floor: one product per slot, and an aisle
    // read by the shelf order. The COMPOSITE spellings, said on the component.
    shelf: {
      type: 'object',
      unique: [['aisle', 'slot']],
      index: [['aisle', 'height']],
      properties: {
        aisle: { type: 'string' },
        slot: { type: 'number' },
        height: { type: 'number' },
      },
    },
    // A review exists ABOUT a product — deleting the product takes its reviews
    // with it (cascade).
    review: {
      type: 'object',
      kind: true,
      properties: {
        stars: { type: 'number' },
        product: { type: 'string', ref: 'product', death: 'cascade' },
      },
    },
    // A bookmark IS a reference: the row's whole reason to exist is to point at
    // something, so deleting the target releases the row (the owner survives).
    bookmark: {
      type: 'object',
      properties: {
        of: { type: 'string', ref: 'entity', death: 'release' },
      },
    },
    // Provenance: server-owned, so the graph's stamp phase is their only
    // writer.
    created: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

export let shop: Vocab = loadVocab(doc)

// A ready store over a fresh in-memory database with the schema installed.
export let store = (): Store => {
  let s = storage(mem(), shop)
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
