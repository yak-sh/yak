// Shared test fixtures (not part of the published package — see deno.json): an
// in-memory SQLite driver (@yaks/sqlite/db `open`), a small made-up vocabulary,
// and just enough table creation to search it. The example domain is a
// bookshop: books with a title and a blurb, reviews with prose of their own,
// and a price that is not text at all — so the tests can prove that search
// reaches every property marked searchable and no others.

import { open } from '@yaks/sqlite/db'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import {
  col,
  type Column,
  type CreateTable,
  type Derived,
  type DerivedProp,
  type Driver,
  eq,
  type Expr,
  insert,
  select,
  sub,
  table,
} from '@yaks/sql'
import { fields, schema } from './mod.ts'

// A Driver over a fresh in-memory database.
export let mem = (): Driver => open(':memory:')

/** A table written out by hand, as a storage adapter would raise it. */
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
/** An entity's spine row, numbered by its id. */
export let entity = (db: Driver, id: number, eid: string) =>
  db.query(insert('entity', { id, eid, num: id }))

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
    // point of searching any property rather than one document component.
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

// A shop whose blurbs are stored elsewhere: the column holds a key and the
// prose is a row in `stash` under that key — the same arrangement @yaks/blob
// uses, reproduced here without depending on it, so the tests exercise only
// this package's side of it.
export let STASH: CreateTable = raised(
  'stash',
  { name: 'key', type: 'text', pk: true },
  text('words'),
)
let words = (key: Expr): Expr =>
  sub(select({
    cols: [col('words', '__s')],
    from: table('stash', '__s'),
    where: eq(col('key', '__s'), key),
  }))
/** A property read through `stash`: its column holds the key, and the words
 * are the stash row under it. */
export let stash = (comp: string, prop: string): DerivedProp => ({
  tag: 'text',
  expr: (owner) =>
    words(sub(select({
      cols: [col(prop, '__c')],
      from: table(comp, '__c'),
      where: eq(col('entity', '__c'), owner),
    }))),
  text: words,
})
export let stashed: Derived = { 'book.blurb': stash('book', 'blurb') }

// The `entity` table and the two component tables, written out by hand: this
// package indexes tables, it does not create them (that is a storage adapter's
// job).
let TABLES = [
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

// A stocked shop: the tables, the indexes, and a few rows to find. Pass `text`
// and the blurbs are stored in `stash` under a key instead of in the row
// itself, which is the same data seen through a content-addressed property.
export let shelf = (text: Derived = {}): Driver => {
  let db = mem()
  let away = !!text['book.blurb']
  for (
    let stmt of [
      ...TABLES,
      ...(away ? [STASH] : []),
      ...schema(fields(shop), text),
    ]
  ) db.query(stmt)
  // The key a stashed blurb is stored under. A content-addressed store would
  // use a hash; here the key only has to come out the same on both sides.
  let key = (blurb: string) => `words-${blurb.length}`
  let book = (id: number, title: string, blurb: string, price: number) => {
    entity(db, id, `book-${id}`)
    if (away) {
      db.query({
        ...insert('stash', { key: key(blurb), words: blurb }),
        or: 'ignore',
      })
    }
    db.query(insert('book', {
      entity: id,
      title,
      blurb: away ? key(blurb) : blurb,
      price,
    }))
  }
  let review = (id: number, prose: string, of: number) => {
    entity(db, id, `review-${id}`)
    db.query(insert('review', { entity: id, prose, stars: 5, book: of }))
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
