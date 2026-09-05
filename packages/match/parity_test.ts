/// <reference lib="deno.ns" />
// The defining test: the same corpus, the same queries, two evaluators.
//
// One side loads the bundles into a SQLite database through @yaks/sqlite and
// answers each query with the statement @yaks/sql compiles. The other holds the
// same bundles in an array and answers with this package. Every query must
// select the same entities, in the same order — that agreement is the whole
// promise: a filter written once means one thing wherever the data lives.

import { assertEquals, assertThrows } from '@std/assert'
import { Database } from '@db/sqlite'
import { storage } from '@yaks/sqlite'
import { matcher } from './match.ts'
import { bundles, corpus, DEAD, NOW, shop } from './harness.ts'

// The corpus in a fresh in-memory database, with the deleted entity deleted.
let sql = () => {
  let db = new Database(':memory:')
  db.exec('pragma foreign_keys = on')
  let s = storage(
    {
      query: (q, params) => db.prepare(q).all(...params),
      exec: (q) => db.exec(q),
    },
    shop,
    { now: NOW },
  )
  s.install()
  // Straight into storage: this test is about READS, so it skips the graph's
  // apply() and puts the rows where the two evaluators can be held against
  // each other. `remove` tombstones the one deleted entity (it is a review
  // nothing points at, so there is no cascade to decide).
  s.tx((tx) => tx.patch(corpus))
  s.tx((tx) => tx.remove([{ eid: DEAD }]))
  return s
}

// Every query both sides must answer alike — one line per feature of the
// grammar, and a few lines that combine them.
let QUERIES = [
  // equality, any-of, negation, absence, presence
  '.status=shelved',
  '.status=shelved,sold',
  '.status!=sold',
  '.status=',
  '.status!',
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
  // booleans and enums
  '.available=1',
  '.available=0',
  '.available!',
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
  '.released=',
  '.released!',
  '.joined=today',
  // the kind scope, singular and plural
  '.kind=book',
  '.kind=books',
  '.kind=doc',
  '.kind=review',
  '.kind=member',
  // references, forward and followed
  '.author=a1',
  '.author=',
  '.author!',
  '.book=b1',
  '.book.author.doc.title~=vale',
  '.book.author.doc.title=Ursula Vale',
  '.book.author.member!',
  '.book.author.member=',
  // backlinks and reverse hops
  '.refs=a1',
  '.refs=b1',
  '.reviews!',
  '.reviews=',
  '.reviews>=2',
  '.reviews=1',
  '.reviews.stars=5',
  '.reviews.stars>=4',
  '.books!',
  // bare words
  'spring',
  'fables',
  'narrow',
  'cat*',
  '"winter journey"',
  'nothingatall',
  // the empty query selects nothing
  '',
  // ordering
  '.kind=book&.order=price',
  '.kind=book&.order=-price',
  '.kind=book&.order=title',
  '.kind=book&.order=released',
  '.kind=book&.order=-released',
  // windows (newest first, whatever else the query asked for)
  '.kind=book&.limit=2',
  '.kind=book&.after=4',
  '.kind=book&.limit=2&.after=6',
  '.kind=book&.order=price&.limit=2',
  // combinations
  'spring .price<20',
  '.kind=book&.available=1&.price<10',
  '.status=shelved&.reviews>=1',
]

let eids = (bs: { entity: { eid: string } }[]) => bs.map((b) => b.entity.eid)

// A failure from the database side names the query that caused it — otherwise a
// broken statement arrives as a bare SQLite message with no way back to the line
// that produced it.
let fromSql = (s: ReturnType<typeof sql>, q: string) => {
  try {
    return s.read(q)
  } catch (e) {
    throw new Error(`@yaks/sql on ${q || '(empty)'}: ${(e as Error).message}`)
  }
}

// A query that names no ordering leaves the order to the evaluator: a database
// hands back whatever its plan yields, this package hands back the order it was
// given. Membership is what both promise there; ORDER is compared for the
// queries that ask for one.
let asks = (q: string) => /\.order=|\.limit=|\.after=/.test(q)

Deno.test('every query selects the same entities', () => {
  let s = sql()
  for (let q of QUERIES) {
    let mine = eids(matcher(q, shop, { now: NOW })(bundles))
    let theirs = eids(fromSql(s, q))
    let label = `query: ${q || '(empty)'}`
    if (asks(q)) assertEquals(mine, theirs, label)
    else assertEquals(mine.sort(), theirs.sort(), label)
  }
})

Deno.test('a query neither side can answer is declined by both', () => {
  let s = sql()
  for (let q of ['.near=b1', '.edges!', '.refs!', '.reviews~=deep']) {
    assertThrows(() => s.read(q), Error, 'cannot compile', q)
    assertThrows(() => matcher(q, shop), Error, 'cannot compile', q)
  }
})
