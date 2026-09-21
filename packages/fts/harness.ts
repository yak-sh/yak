// Shared test fixtures (not part of the published package — see deno.json): an
// in-memory SQLite driver over jsr:@db/sqlite, a small made-up vocabulary, and
// just enough table creation to search it. The example domain is a bookshop:
// books with a title and a blurb, reviews with prose of their own, and a price
// that is not text at all — so the tests can prove that search reaches every
// column marked searchable and no others.

import { Database } from '@yaks/sqlite/db'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import type { Driver } from './driver.ts'
import { fields, schema, type Text } from './mod.ts'

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
        blurb: { type: 'string', search: true },
        price: { type: 'number' },
      },
    },
    // What a reader wrote about one. Prose in a second component — the whole
    // point of searching any column rather than one document component.
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

export let shop: Vocab = loadVocab(doc)

// A shop whose blurbs are stored elsewhere: the column holds a KEY and the
// prose is a row in `stash` under that key — the same arrangement @yaks/blob
// uses, reproduced here without depending on it, so the tests exercise only
// this package's side of it.
export let STASH = `create table stash (key text primary key, words text)`
export let stashed: Text = {
  'book.blurb': (address) =>
    `(select __s."words" from "stash" __s where __s."key" = ${address})`,
}

// The `entity` table and the two component tables, written out by hand: this
// package indexes tables, it does not create them (that is a storage adapter's
// job).
let TABLES = [
  `create table entity (id integer primary key, eid text not null unique, num integer)`,
  `create table tombstone (entity integer primary key references entity(id), deleted_at text not null)`,
  `create table book (entity integer primary key references entity(id), title text, blurb text, price real)`,
  `create table review (entity integer primary key references entity(id), prose text, stars real, book integer references entity(id))`,
]

// A stocked shop: the tables, the indexes, and a few rows to find. Pass `text`
// and the blurbs are stored in `stash` under a key instead of in the row
// itself, which is the same data seen through a content-addressed column.
export let shelf = (text: Text = {}): Driver => {
  let db = mem()
  let away = !!text['book.blurb']
  for (
    let stmt of [
      ...TABLES,
      ...(away ? [STASH] : []),
      ...schema(fields(shop), text),
    ]
  ) db.exec(stmt)
  let entity = (id: number, eid: string) =>
    db.exec(`insert into entity (id, eid, num) values (${id}, '${eid}', ${id})`)
  // The key a stashed blurb is stored under. A content-addressed store would
  // use a hash; here the key only has to come out the same on both sides.
  let key = (blurb: string) => `words-${blurb.length}`
  let book = (id: number, title: string, blurb: string, price: number) => {
    entity(id, `book-${id}`)
    if (away) {
      db.query(`insert or ignore into stash (key, words) values (?, ?)`, [
        key(blurb),
        blurb,
      ])
    }
    db.query(
      `insert into book (entity, title, blurb, price) values (?, ?, ?, ?)`,
      [id, title, away ? key(blurb) : blurb, price],
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
