// Shared test fixtures (not part of the published package — see deno.json): a
// shared document editor, written as a vocabulary.
//
// Two people keep a handful of pages. Each of them works through a run — an
// editor window, or an agent turn — and a run locks a page while it edits it.
// The store is @yaks/ram, which is how a page or a test composes this
// package: a Map holding the bundles, the same `apply()` and the same rules as
// a database.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import type { Bundle, Comp, Query } from '@yaks/graph'
import { type And, parse } from '@yaks/query'
import type { Computed } from '@yaks/match'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { executionComputed } from '@yaks/tools'
import { attemptComputed } from './attempt.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model/vocab'
import { sessionDoc } from './comp.ts'
import { type SessionOpts, sessions } from './plugin.ts'
import { statusOf } from './status.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    person: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: { type: 'string' } },
    },
    page: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        text: { type: 'string' },
        by: { type: 'string', ref: 'entity', death: 'detach' },
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

/** The editor's vocabulary: people, pages, and the session domain loaded
 * beside them. */
export let pages: Vocab = loadVocab([sessionDoc, toolsDoc, modelDoc, doc])

/** The ids the tests share: two people, two of their runs, a run the graph
 * never saw, two pages. */
export let ids = {
  ada: 'ada',
  bo: 'bo',
  run1: 'run1', // Ada's run
  run2: 'run2', // Bo's run
  gone: '51f8a79e-249f-4408-9d4a-72f55fcb8ad1', // an absent minted run
  p1: 'page1',
  p2: 'page2',
}

/** A store holding two people, two runs and two pages, with nothing locked
 * yet. */
export let store = (): Storage => {
  let s = ram(pages, {
    number: true,
    computed: { ...executionComputed, ...attemptComputed },
  })
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

/** Which session holds a page's lock right now, or `undefined` when it is
 * free. */
export let lockOn = (
  s: Storage,
  page: string,
): Record<string, unknown> | undefined =>
  (s.tx((tx) => tx.get([page])) as Bundle[])[0]?.claim as
    | Record<string, unknown>
    | undefined

/** Seed the identities a fixture names without giving them domain components. */
export let seedIdentities = (g: Graph, ...eids: string[]) =>
  g.apply(eids.map((eid) => ({ entity: { eid } })))

let queries = new Map<string, And>()
let queryOf = (query: Query): And => {
  if (typeof query != 'string') return query
  let known = queries.get(query)
  if (!known) queries.set(query, known = parse(query))
  return known
}

let transcriptComputed: Computed = {
  'session.status': (b, among) =>
    statusOf(
      among.list.filter((entry) =>
        (entry.entry as Comp | undefined)?.session == b.entity.eid
      ),
    ),
}

/** A transcript's graph door over RAM, with entry sequencing and status.
 * Model/reporting tests need these facts without the unrelated session hooks. */
export let transcriptGraph = (vocab: Vocab): Graph => {
  let storage = ram(vocab, { computed: transcriptComputed })
  let g = graph({ storage, vocab })
  g.read = (query, opts) => storage.read(queryOf(query), opts)
  g.get = storage.get
  g.rows = (query, opts) => storage.rows(queryOf(query), opts)
  let sequences = new Map<string, number>()
  g.apply = (rows) => {
    let next = new Map(sequences)
    let saved = storage.tx((tx) => {
      rows = rows.map((row) => {
        let entry = row.entry as Comp | undefined
        if (!entry || tx.get([row.entity.eid])[0]?.entry) return row
        let owner = String(entry.session)
        let seq = Number(entry.seq) || (next.get(owner) ?? 0) + 1
        next.set(owner, Math.max(seq, next.get(owner) ?? 0))
        return { ...row, entry: { ...entry, seq } }
      })
      tx.patch(rows)
      return rows
    })
    sequences = next
    return saved
  }
  return g
}
