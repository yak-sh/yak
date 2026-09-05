// Shared test fixtures (not part of the published package — see deno.json): an
// in-memory SQLite driver over jsr:@db/sqlite, a small made-up vocabulary, and
// just enough table-building to search it. The domain is a bookshop: books with
// a title and a blurb, reviews with prose of their own, and a price that is not
// text at all — so the tests can prove that search reaches EVERY text property
// and no others.

import { Database } from '@db/sqlite'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import type { Driver } from './driver.ts'
import { fields, schema } from './mod.ts'

// A Driver over a fresh in-memory database.
export let mem = (): Driver => {
  let db = new Database(':memory:')
  return {
    query: (sql, params) => db.prepare(sql).all(...params),
    exec: (sql) => db.exec(sql),
  }
}

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A book on the shelf: what it is called, what it is about, what it costs.
    book: {
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        blurb: { type: 'string' },
        price: { type: 'number' },
      },
    },
    // What a reader said about one. Prose in a second component — the whole
    // point of searching any property rather than one document component.
    review: {
      type: 'object',
      kind: true,
      properties: {
        prose: { type: 'string' },
        stars: { type: 'number' },
        book: { type: 'string', ref: 'book', death: 'cascade' },
      },
    },
  },
}

export let shop: Vocab = loadVocab(doc)

// The spine and the two component tables, hand-written: this package indexes
// tables, it does not create them (that is a storage adapter's job).
let TABLES = [
  `create table entity (id integer primary key, eid text not null unique, num integer)`,
  `create table tombstone (entity integer primary key references entity(id), deleted_at text not null)`,
  `create table book (entity integer primary key references entity(id), title text, blurb text, price real)`,
  `create table review (entity integer primary key references entity(id), prose text, stars real, book integer references entity(id))`,
]

// A stocked shop: the tables, the indexes, and a few rows to find.
export let shelf = (): Driver => {
  let db = mem()
  for (let stmt of [...TABLES, ...schema(fields(shop))]) db.exec(stmt)
  let entity = (id: number, eid: string) =>
    db.exec(`insert into entity (id, eid, num) values (${id}, '${eid}', ${id})`)
  let book = (id: number, title: string, blurb: string, price: number) => {
    entity(id, `book-${id}`)
    db.query(
      `insert into book (entity, title, blurb, price) values (?, ?, ?, ?)`,
      [id, title, blurb, price],
    )
  }
  let review = (id: number, prose: string, of: number) => {
    entity(id, `review-${id}`)
    db.query(
      `insert into review (entity, prose, stars, book) values (?, ?, 5, ?)`,
      [
        id,
        prose,
        of,
      ],
    )
  }
  book(1, 'The Hobbit', 'A burglar leaves home and meets a dragon.', 12)
  book(2, 'Dragonflight', 'Riders and their dragon defend a world.', 18)
  book(
    3,
    'Kitchen Confidential',
    'A cook writes down what the nights are like.',
    9,
  )
  review(4, 'The dragon chapters are the best pages here.', 1)
  return db
}
