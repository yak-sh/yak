// Shared test fixtures (not part of the published package — see deno.json): a
// wiki, written as a vocabulary. Pages several people edit, notes that exist
// about a page, pages that cite pages, pages under a parent page, and pins on
// a page — so a deleted page takes its notes and its citations with it, leaves
// its children without a parent and drops the pins on it, every way a delete
// spreads (@yaks/graph's cascade) is something the tests can watch the journal
// record. A page's text is kept by its address (@yaks/blob), as a body is on
// the box, so the tests also watch the log read it back as text.
//
// The log is tables beside the store's own, so a fixture is a database: one
// `mem()`, the wiki's tables installed on it, the journal's `ddl()` run against
// it, and a graph over both. The clock is fixed, so a test can assert on the
// timestamp a transaction was stamped with.

import {
  blobKeywords,
  blobRead,
  blobs,
  blobSchema,
  sqliteBlobs,
} from '@yaks/blob'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { isPromise } from '@yaks/fp'
import { type Graph, graph, type Options } from '@yaks/graph'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { mem } from '../sqlite/testing.ts'
import { storage } from '../sqlite/mod.ts'
import { type Driver, lit } from '@yaks/sql'
import { ddl, journal, type Log, log } from './log.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    page: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        text: { type: 'string', store: 'blob' },
        locked: { type: 'boolean' },
        // A page whose parent is deleted is still a page.
        parent: { type: 'string', ref: 'page', death: 'detach' },
      },
    },
    // A pin exists only to point at a page: it goes when the page does, and
    // what wore it stays.
    pin: {
      component: true,
      type: 'object',
      properties: { page: { type: 'string', ref: 'page', death: 'release' } },
    },
    // One page citing another, an edge (@yaks/edge).
    cites: { component: true, type: 'object', edge: true },
    // A note has nothing left to be about once its page is gone.
    note: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        text: { type: 'string' },
        page: { type: 'string', ref: 'page', death: 'cascade' },
      },
    },
    // An event: who read a page as it was written, heard and never kept.
    read: {
      component: true,
      type: 'object',
      durable: '0s',
      properties: { by: { type: 'string' } },
    },
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

/** The wiki vocabulary the tests write against. */
export let wiki: Vocab = loadVocab([doc, edgeDoc], [edgeKeywords, blobKeywords])

/** How the wiki's store reads a page's text back from the address it keeps. */
export let derived = blobRead(wiki)

/** The timestamp every fixture transaction is stamped with. */
export let NOW = '2026-01-01T00:00:00.000Z'

// The actors and instruments the tests write as. A `journal_tx` row names them
// by their id in the entity table, so they have to be entities before anything
// can be attributed to them — inserted straight into that table, so seeding
// them is not itself a transaction the tests then have to count past.
let ACTORS = ['ada', 'bob', 'cli']

/** An embedded database with the wiki's tables and the journal's, and a log
 * bound to it — what a graph and a test both read through. The driver is
 * returned beside them, because `@yaks/journal/rules` and
 * `@yaks/journal/tools` are both built from the server's own connection. */
export let wikiLog = (): {
  g: (p?: Options['plugins']) => Graph
  j: Log
  sql: Driver
  /** another host over the same database: a graph journaling as a log of its
   * own, the way a second process or thread opening the file would */
  other: () => { g: Graph; j: Log }
} => {
  let db = mem()
  let store = storage(db, wiki, { derived })
  store.install()
  for (let s of [...blobSchema(), ...ddl()]) db.query(s)
  let texts = blobs(wiki, sqliteBlobs(db))
  db.query({
    t: 'insert',
    into: 'entity',
    cols: ['eid'],
    rows: ACTORS.map((a) => [lit(a)]),
  })
  let as = (j: Log, plugins: Options['plugins'] = []) =>
    graph({
      storage: store,
      vocab: wiki,
      plugins: [
        journal(j, { now: () => NOW }),
        edges(wiki),
        texts,
        ...plugins,
      ],
    })
  let bound = () => log({ rows: (s) => db.query(s), derived })
  let j = bound()
  return {
    g: (plugins = []) => as(j, plugins),
    j,
    sql: db,
    other: () => {
      let j = bound()
      return { g: as(j), j }
    },
  }
}

/** A graph over a fresh database, journaling into it, plus whatever a test
 * brings — with the log it writes to beside it. */
export let wikiGraph = (
  plugins: Options['plugins'] = [],
): { g: Graph; j: Log; sql: Driver } => {
  let held = wikiLog()
  return { g: held.g(plugins), j: held.j, sql: held.sql }
}

/** Every adapter under the tests here is synchronous; a promise means the
 * stack went async over an embedded database, which is the bug. */
export let sync = <T>(out: T | Promise<T>): T => {
  if (isPromise(out)) {
    throw new Error('the stack went async over an embedded database')
  }
  return out as T
}
