// Shared test fixtures (not part of the published package — see deno.json): a
// small made-up vocabulary and a set of bundles the test files run against. The
// domain is a bookshop — documents, books, reviews, members — chosen because it
// exercises every property type the grammar can ask about (text, prose, number,
// boolean, enum, timestamp, reference) and both directions of a reference, and
// because reading the tests needs no knowledge from outside this file.

import type { Bundle } from './read.ts'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A named thing: a title and a body of prose. Everything in the shop has
    // one, so this is also where the searchable text lives.
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string', search: true },
        body: { type: 'string', search: true },
      },
    },
    // A book on sale: what it costs, when it came out, whether it is in stock,
    // what state it is in, and who wrote it.
    book: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        price: { type: 'number' },
        released: { type: 'string', format: 'date-time' },
        available: { type: 'boolean' },
        status: { type: 'string', enum: ['draft', 'shelved', 'sold'] },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    // A review is about a book — deleting the book deletes its reviews too.
    review: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        stars: { type: 'number' },
        book: { type: 'string', ref: 'book', death: 'cascade' },
      },
    },
    // Someone with a card, and the day they got it.
    member: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { joined: { type: 'string', format: 'date-time' } },
    },
    // A tag: a component with no properties at all, where having it is the
    // whole fact. It records that the shop signed this copy; there is nothing
    // else to record about it, so `.signed` and `!signed` are the only
    // questions it answers.
    signed: {
      component: true,
      type: 'object',
      properties: {},
    },
  },
}

/** The bookshop vocabulary. */
export let shop: Vocab = loadVocab(doc)

/** The moment every relative time phrase in the tests resolves against. */
export let NOW: number = Date.parse('2024-06-15T12:00:00.000Z')

// The bundles, written in dependency order so an entity is created before
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

/** The eid of the entity that is deleted after the fixture is written. */
export let DEAD = 'r9'

/** The fixture as it is written to storage, in order. */
export let corpus: Bundle[] = rows

/**
 * The same fixture as a caller holds it in memory: the entity numbers storage
 * would assign (one per bundle, in write order), and the deleted entity as the
 * tombstone it becomes — its component rows gone, its identity kept.
 */
export let bundles: Bundle[] = rows.map((b, i) => {
  let entity = { eid: b.entity.eid, num: i + 1 }
  return b.entity.eid == DEAD ? { entity, tombstone: {} } : { ...b, entity }
})

/**
 * Every query an evaluator must answer alike over the fixture — one line per
 * feature of the grammar, and a few lines that combine them.
 */
export let QUERIES: string[] = [
  // equality, any-of, negation, absence, presence
  '.status=shelved',
  '.status=shelved,sold',
  '.status!=sold',
  '!status',
  '.status',
  '.stars=3,5',
  '.price=12',
  '.price=7.5',
  '.price=0',
  '.price!=12',
  // ranges and comparisons
  '.price=0..12',
  '.price=0...12',
  '.price>=10',
  '.price<10',
  '.stars>3',
  '.stars<=3',
  // a tag: a component with no properties, where presence is the whole fact
  '.signed',
  '!signed',
  '.signed~=',
  // a bare bang completes a component sentence even where a property of the
  // same name claims the bare name: `.book` is the books, `.book=b1` is
  // still review.book, and `.review.book` still reaches the property.
  '.book',
  '!book',
  '.review.book',
  // booleans and enums
  '.available=1',
  '.available=0',
  '.available',
  // contains
  '.title~=spring',
  '.title~=SPRING',
  '.title~=left hand',
  '.body~=',
  // time: a stamp, a day, a phrase, a comparison, an absence
  '.released=2024-06-15',
  '.released=today',
  '.released=today,yesterday',
  '.released!=today',
  '.released<2024-01-01',
  '.released>=2024-06-15',
  '!released',
  '.released',
  '.joined=today',
  // the kind scope, singular and plural
  '.kind=book',
  '.kind=books',
  '.kind=doc',
  '.kind=review',
  '.kind=member',
  // references, forward and followed
  '.author=a1',
  '!author',
  '.author',
  '.book=b1',
  '.book.author.doc.title~=vale',
  '.book.author.doc.title=Ursula Vale',
  '.book.author.member',
  '!book.author.member',
  // identity: naming entities instead of filtering them — an eid, a list of
  // them, a spine number, a human id (`B-3` is the entity numbered 3), a mixed
  // list, and a name nothing wears
  '.eid=b1',
  '.eid=b1,b2',
  '!eid',
  '.entity.eid=b1',
  '.num=3',
  '.num=3,4',
  '.eid=B-3',
  '.eid=b1,B-4',
  '.eid=nosuchentity',
  // the deleted entity is named but still dead
  '.eid=r9',
  // backlinks and reverse hops
  '.refs=a1',
  '.refs=b1',
  '.reviews',
  '!reviews',
  '.reviews>=2',
  '.reviews=1',
  '.reviews.stars=5',
  '.reviews.stars>=4',
  '.books',
  // bare words
  'spring',
  'fables',
  'narrow',
  'cat*',
  '"winter journey"',
  'nothingatall',
  // the empty query selects nothing
  '',
  // `*` is a projection — every component of every row it selects — so it
  // filters nothing and the line means what it would without it. Both
  // evaluators read it off the clause list rather than as a text term, which
  // is what a `/query` line and a `/ws` subscription's line have in common.
  '*',
  '.kind=book&*',
  '.price<10&*',
  // ordering
  '.kind=book&.order=price',
  '.kind=book&.order=-price',
  '.kind=book&.order=title',
  '.kind=book&.order=released',
  '.kind=book&.order=-released',
  // windows: newest first when nothing else is asked, and within the asked
  // order when there is one — `.after` naming the entity to continue past,
  // wherever it sits in that order.
  '.kind=book&.limit=2',
  '.kind=book&.limit=0',
  '.kind=book&.after=4',
  '.kind=book&.limit=2&.after=6',
  '.kind=book&.order=price&.limit=2',
  '.kind=book&.order=price&.after=5',
  '.kind=book&.order=price&.limit=2&.after=6',
  '.kind=book&.order=-price&.limit=2&.after=4',
  '.kind=book&.order=title&.after=4',
  '.kind=book&.order=-released&.limit=2&.after=5',
  // an anchor with no value for the ordered property pages by its num alone
  '.order=price&.limit=3&.after=2',
  // an anchor outside the selection still names a place in the order
  '.kind=book&.order=price&.after=9',
  // an anchor no entity has restarts from the first page
  '.kind=book&.order=price&.limit=2&.after=99999',
  // combinations
  'spring .price<20',
  '.kind=book&.available=1&.price<10',
  '.status=shelved&.reviews>=1',
]
