// Shared test fixtures (not part of the published package — see deno.json): a
// houseplant and a calendar entry, written as a vocabulary.
//
// The store is @yaks/ram, which is how a browser page or a test composes this
// package — a Map holding the bundles, with the same `apply()` and the same
// query grammar as a database. Every time value is a number the test passes in,
// so nothing here waits.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { wakeDoc } from './comp.ts'
import { type Opts, wakes } from './plugin.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    plant: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: { type: 'string' } },
    },
    entry: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        name: { type: 'string' },
        on: { type: 'string', format: 'date-time' },
      },
    },
  },
}

/** The household's vocabulary: its things, and wake loaded beside them. */
export let home: Vocab = loadVocab([wakeDoc, doc])

/** A fixed moment every test measures from: a Thursday, 09:17 UTC. */
export let T0: number = Date.parse('2026-01-01T09:17:00Z')

/** One hour, in milliseconds — the unit the tests step by. */
export let HOUR = 3_600_000

/** An empty store over that vocabulary. */
export let store = (): Storage => ram(home)

/** A graph over a store, with the wake plugin and a clock the test controls. */
export let woken = (s: Storage, opts: Opts = {}): Graph =>
  graph({
    storage: s,
    vocab: home,
    plugins: [wakes({ now: () => T0, ...opts })],
  })
