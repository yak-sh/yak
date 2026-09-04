// Shared test fixtures (not part of the published package — see deno.json): an
// in-memory SQLite driver over jsr:@db/sqlite, and a small made-up vocabulary
// the test files write against. The domain is a tiny shop — documents,
// products, reviews, makers, bookmarks — chosen so it exercises every reference
// death word (a review cascades with its product, a product detaches from a
// deleted maker, a bookmark is released) without any knowledge outside this
// file.

import { Database } from '@db/sqlite'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import type { Driver } from './driver.ts'
import { type Storage, storage } from './mod.ts'

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
        body: { type: 'string', store: 'blob' },
      },
    },
    // Something for sale: a price, a state, and the maker who made it. Deleting
    // a maker detaches the product (the column is nulled), never deletes it.
    product: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        price: { type: 'number' },
        available: { type: 'boolean' },
        status: { enum: ['draft', 'live', 'sold'] },
        maker: { type: 'string', ref: 'entity', death: 'detach' },
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
  },
}

export let shop: Vocab = loadVocab(doc)

// A ready store over a fresh in-memory database with the schema installed.
export let store = (): Storage => {
  let s = storage(mem(), shop)
  s.install()
  return s
}
