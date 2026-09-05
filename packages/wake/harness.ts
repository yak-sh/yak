// Shared test fixtures (not part of the published package — see deno.json): a
// houseplant and a calendar entry, written as a vocabulary.
//
// The store is @yaks/memory, which is how a page or a test composes this
// package — a Map holding the bundles, the same `apply()` and the same query
// grammar as a database. Every clock is a number a test hands in, so nothing
// here waits.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { memory } from '@yaks/memory'
import { wakeDoc } from './comp.ts'
import { type Opts, wakes } from './plugin.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    plant: { type: 'object', kind: true, properties: { name: {} } },
    entry: {
      type: 'object',
      kind: true,
      properties: { name: {}, on: { type: 'string', format: 'date-time' } },
    },
  },
}

/** The household's vocabulary: its things, and wake loaded beside them. */
export let home: Vocab = loadVocab([wakeDoc, doc])

/** A fixed moment every test reckons from: a Thursday, 09:17 UTC. */
export let T0: number = Date.parse('2026-01-01T09:17:00Z')

/** One hour, in milliseconds — the unit the tests step by. */
export let HOUR = 3_600_000

/** An empty store over that vocabulary. */
export let store = (): Storage => memory(home)

/** A graph over a store, with the wake plugin on it and a clock a test owns. */
export let woken = (s: Storage, opts: Opts = {}): Graph =>
  graph({
    storage: s,
    vocab: home,
    plugins: [wakes({ now: () => T0, ...opts })],
  })
