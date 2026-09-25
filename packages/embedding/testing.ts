// Shared test fixtures (not part of the published package — see deno.json): an
// in-memory SQLite driver (@yaks/sqlite/db `open`), a small made-up vocabulary,
// and just enough table-building to search it. The domain is a bookshop: books
// with a title and a blurb, reviews with prose of their own, and a price that
// is not text at all — so the tests can prove that a vector is made of every
// text property and no others.

import { open } from '@yaks/sqlite/db'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Driver, insert } from '@yaks/sql'
import { BOOKSHOP, entity } from '../sqlite/testing.ts'
import { fields, schema, sweep } from './mod.ts'
import { hashEmbedder } from './embedder.ts'

/** A Driver over a fresh in-memory database. */
export let mem = (): Driver => open(':memory:')

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A book on the shelf: what it is called, what it is about, what it costs.
    book: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string', search: true },
        blurb: { type: 'string' },
        price: { type: 'number' },
      },
    },
    // What a reader said about one. Prose in a second component — the whole
    // point of embedding any property rather than one document component.
    review: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        prose: { type: 'string', search: true },
        stars: { type: 'number' },
        book: { type: 'string', ref: 'book', death: 'cascade' },
      },
    },
  },
}

/** The bookshop vocabulary. */
export let shop: Vocab = loadVocab(doc)

/** The deterministic embedder every test here uses. */
export let embedder = hashEmbedder()

/** A shop with its tables (written out by hand: this package stores vectors
 * beside them, it does not create them), its vector table, and a few books to
 * find. */
export let shelf = (): Driver => {
  let db = mem()
  for (let stmt of [...BOOKSHOP, ...schema()]) db.query(stmt)
  let book = (id: number, title: string, blurb: string, price: number) => {
    entity(db, id, `book-${id}`)
    db.query(insert('book', { entity: id, title, blurb, price }))
  }
  let review = (id: number, prose: string, of: number) => {
    entity(db, id, `review-${id}`)
    db.query(insert('review', { entity: id, prose, stars: 5, book: of }))
  }
  // Two dragon books, one kitchen memoir: the first two should be neighbours
  // and the third should not, on shared words alone.
  book(1, 'The Hobbit', 'A burglar leaves home and meets a dragon.', 12)
  book(2, 'Dragonflight', 'A burglar meets a dragon and leaves home.', 18)
  book(3, 'Kitchen Confidential', 'A cook writes what the nights are like.', 9)
  review(4, 'The dragon chapters are the best pages here.', 1)
  return db
}

/** That shop with every vector already stored. */
export let stocked = async (): Promise<Driver> => {
  let db = shelf()
  await sweep(db, fields(shop), embedder)
  return db
}
