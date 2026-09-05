// Shared test fixtures (not part of the published package — see deno.json): a
// small made-up vocabulary and a corpus of bundles the test files read against.
// The domain is a bookshop — documents, books, reviews, members — chosen
// because it exercises every column type the grammar can ask about (text, prose,
// number, boolean, enum, timestamp, reference) and both directions of a
// reference, without any knowledge outside this file.

import type { Bundle } from '@yaks/graph'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A named thing: a title and a body of prose. Everything in the shop wears
    // one, so this is also where the searchable text lives.
    doc: {
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    // A book on sale: what it costs, when it came out, whether it is in stock,
    // where it is in its life, and who wrote it.
    book: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        price: { type: 'number' },
        released: { type: 'string', format: 'date-time' },
        available: { type: 'boolean' },
        status: { enum: ['draft', 'shelved', 'sold'] },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    // A review exists ABOUT a book — deleting the book takes its reviews too.
    review: {
      type: 'object',
      kind: true,
      properties: {
        stars: { type: 'number' },
        book: { type: 'string', ref: 'book', death: 'cascade' },
      },
    },
    // Someone with a card, and the day they got it.
    member: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { joined: { type: 'string', format: 'date-time' } },
    },
    // A TAG: a component with no columns at all, whose presence is the whole
    // fact. Wearing it says the shop signed this copy; there is nothing else to
    // say about it, so `.signed!` and `.signed=` are the only questions it
    // answers.
    signed: { type: 'object', properties: {} },
  },
}

/** The bookshop vocabulary. */
export let shop: Vocab = loadVocab(doc)

/** The moment every relative time phrase in the tests resolves against. */
export let NOW: number = Date.parse('2024-06-15T12:00:00.000Z')

// The corpus, written in dependency order so an entity is minted before
// anything points at it, which makes the entity numbers below match the order
// of this list.
let rows: Bundle[] = [
  {
    entity: { eid: 'a1' },
    doc: { title: 'Ursula Vale', body: 'writes fables' },
  },
  {
    entity: { eid: 'a2' },
    doc: { title: 'Milo Frank', body: 'writes manuals' },
  },
  {
    entity: { eid: 'b1' },
    doc: { title: 'The Left Hand of Spring', body: 'a winter journey north' },
    book: {
      price: 12,
      released: '2024-06-15T09:00:00.000Z',
      available: true,
      status: 'shelved',
      author: 'a1',
    },
  },
  {
    entity: { eid: 'b2' },
    doc: { title: 'Cooking on a Barge', body: 'recipes for narrow kitchens' },
    book: {
      price: 30,
      released: '2023-01-09T10:00:00.000Z',
      available: false,
      status: 'sold',
      author: 'a2',
    },
  },
  {
    entity: { eid: 'b3' },
    doc: { title: 'Spring Catalogue', body: 'everything on the shelves' },
    book: {
      price: 0,
      released: '2024-06-14T08:00:00.000Z',
      available: true,
      status: 'draft',
    },
  },
  {
    entity: { eid: 'b4' },
    doc: { title: 'Fables of the North', body: 'short stories' },
    book: { price: 7.5, available: true, status: 'shelved', author: 'a1' },
    signed: {},
  },
  { entity: { eid: 'r1' }, review: { stars: 5, book: 'b1' } },
  { entity: { eid: 'r2' }, review: { stars: 3, book: 'b1' } },
  { entity: { eid: 'r3' }, review: { stars: 4, book: 'b2' } },
  {
    entity: { eid: 'm1' },
    doc: { title: 'Ada Card' },
    member: { joined: '2024-06-15T06:00:00.000Z' },
  },
  {
    entity: { eid: 'd1' },
    doc: { title: 'Opening hours', body: 'nine to five' },
  },
  { entity: { eid: 'r9' }, review: { stars: 1, book: 'b3' } },
]

/** The eid whose entity is deleted after the corpus is written. */
export let DEAD = 'r9'

/** The corpus as it is written to storage, in order. */
export let corpus: Bundle[] = rows

/**
 * The same corpus as a caller holds it in memory: the entity numbers storage
 * would mint (one per bundle, in write order), and the deleted entity as the
 * tombstone it becomes — its component rows gone, its identity kept.
 */
export let bundles: Bundle[] = rows.map((b, i) => {
  let entity = { eid: b.entity.eid, num: i + 1 }
  return b.entity.eid == DEAD ? { entity, tombstone: {} } : { ...b, entity }
})
