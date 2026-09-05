// Shared test fixtures (not part of the published package — see deno.json): a
// small team's to-do list, written as a vocabulary.
//
// The team writes `doc{title}` on everything and files its tasks under projects.
// That `doc` is @yaks/doc's, loaded beside this package's rather than spelled
// out again here — which is also the composition the README teaches. The store
// is @yaks/memory, which is how a page or a test composes this package — a Map
// holding the bundles, the same apply() and the same query grammar as a
// database.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { memory } from '@yaks/memory'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { taskDoc } from './comp.ts'
import { tasks } from './plugin.ts'
import type { Mark } from './words.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    person: { type: 'object', kind: true, properties: { name: {} } },
    // A lease, so a test can add the `wip` rung the way an application would.
    claim: {
      type: 'object',
      properties: {
        person: { type: 'string', ref: 'person', death: 'cascade' },
      },
    },
  },
}

/** The team's vocabulary: this package's components, `doc`, edges, and their
 * own. */
export let team: Vocab = loadVocab(
  [docDoc, edgeDoc, taskDoc, doc],
  [edgeKeywords],
)

/** A fresh in-memory storage over that vocabulary. */
export let store = (): Storage => memory(team)

/** A graph over a fresh store, with the edge and task plugins wired. */
export let teamGraph = (
  storage: Storage = store(),
  marks?: Mark[],
): { g: Graph; storage: Storage } => ({
  g: graph({
    storage,
    vocab: team,
    plugins: [edges(team), tasks(team, marks)],
  }),
  storage,
})
