// Shared test fixtures (not part of the published package — see deno.json): a
// shared document editor, written as a vocabulary.
//
// Two people keep a handful of pages. Each of them works through a RUN — an
// editor window, or an agent turn — and a run locks a page while it edits it.
// The store is @yaks/ram, which is how a page or a test composes this
// package: a Map holding the bundles, the same `apply()` and the same rules as
// a database.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import type { Bundle } from '@yaks/graph'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { sessionDoc } from './comp.ts'
import { type SessionOpts, sessions } from './plugin.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    person: { type: 'object', kind: true, properties: { name: {} } },
    page: {
      type: 'object',
      kind: true,
      properties: {
        title: {},
        text: {},
        by: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    created: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

/** The editor's vocabulary: people, pages, and the session domain loaded
 * beside them. */
export let pages: Vocab = loadVocab([sessionDoc, doc])

/** The ids the tests share: two people, two of their runs, a run the graph
 * never saw, two pages. */
export let ids = {
  ada: 'ada',
  bo: 'bo',
  run1: 'run1', // Ada's run
  run2: 'run2', // Bo's run
  gone: 'gone', // a run no entity stands for
  p1: 'page1',
  p2: 'page2',
}

/** A store holding two people, two runs and two pages, with nothing locked
 * yet. */
export let store = (): Storage => {
  let s = ram(pages)
  let { ada, bo, run1, run2, p1, p2 } = ids
  graph({ storage: s, vocab: pages }).apply([
    { entity: { eid: ada }, person: { name: 'Ada' } },
    { entity: { eid: bo }, person: { name: 'Bo' } },
    { entity: { eid: run1 }, session: { id: 'one' } },
    { entity: { eid: run2 }, session: { id: 'two' } },
    { entity: { eid: p1 }, page: { title: 'Lemon cake', by: ada } },
    { entity: { eid: p2 }, page: { title: 'Potluck', by: bo } },
  ], { trusted: true })
  return s
}

/** A graph over that store with the session rules on it, its clock and its
 * conflict ids held still. */
export let locked = (s: Storage, opts: SessionOpts = {}): Graph =>
  graph({ storage: s, vocab: pages, plugins: [sessions(opts)] })

/** An unguarded write into the store — how the fixture was set up, and how a
 * test arranges the next thing to try. */
export let seed = (s: Storage, ...bundles: Bundle[]) => {
  graph({ storage: s, vocab: pages }).apply(bundles, { trusted: true })
}

/** What a page's lock says right now, or `undefined` when it is free. */
export let lockOn = (
  s: Storage,
  page: string,
): Record<string, unknown> | undefined =>
  (s.tx((tx) => tx.get([page])) as Bundle[])[0]?.claim as
    | Record<string, unknown>
    | undefined
