// Shared test fixtures (not part of the published package — see deno.json): a
// wiki, written as a vocabulary. Pages several people edit, and notes that
// exist ABOUT a page — so a deleted page takes its notes with it and a
// cascade's casualties are something the tests can watch a journal record.
//
// The log is tables beside the store's own, so a fixture is a database: one
// `mem()`, the wiki's tables installed on it, the journal's `ddl()` run against
// it, and a graph over both. The clock is fixed, so a test can assert on the
// moment a batch was stamped with.

import { type Graph, graph, isPromise, type Options } from '@yaks/graph'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { mem } from '../sqlite/harness.ts'
import { storage } from '../sqlite/mod.ts'
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
        text: { type: 'string' },
        locked: { type: 'boolean' },
      },
    },
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
export let wiki: Vocab = loadVocab([doc])

/** The moment every fixture batch is stamped with. */
export let NOW = '2026-01-01T00:00:00.000Z'

// The actors and instruments the tests write as. A batch row names them by
// their spine id, so they have to BE entities before anything can be
// attributed to them — seeded straight onto the spine, so seeding is not
// itself a batch the tests then have to count past.
let ACTORS = ['ada', 'bob', 'cli']

/** An embedded database with the wiki's tables and the journal's, and a log
 * bound to it — what a graph and a test both read through. */
export let wikiLog = (): { g: (p?: Options['plugins']) => Graph; j: Log } => {
  let db = mem()
  let store = storage(db, wiki)
  store.install()
  db.exec(ddl())
  db.exec(
    `insert into entity (eid) values ${
      ACTORS.map((a) => `('${a}')`).join(', ')
    }`,
  )
  let j = log({
    rows: (sql, params) =>
      db.query(sql, params as never[]) as Record<string, unknown>[],
  })
  return {
    g: (plugins = []) =>
      graph({
        storage: store,
        vocab: wiki,
        plugins: [journal(j, { now: () => NOW }), ...plugins],
      }),
    j,
  }
}

/** A graph over a fresh database, journaling into it, plus whatever a test
 * brings — with the log it writes to beside it. */
export let wikiGraph = (
  plugins: Options['plugins'] = [],
): { g: Graph; j: Log } => {
  let held = wikiLog()
  return { g: held.g(plugins), j: held.j }
}

/** Every adapter under the tests here is synchronous; a promise means the
 * stack went async over an embedded database, which is the bug. */
export let sync = <T>(out: T | Promise<T>): T => {
  if (isPromise(out)) {
    throw new Error('the stack went async over an embedded database')
  }
  return out as T
}
