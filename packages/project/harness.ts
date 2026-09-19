// Shared test fixtures (not part of the published package — see deno.json): a
// small team's portfolio, written as a vocabulary.
//
// The same team @yaks/task's harness describes, with what its tasks are FILED
// in: the store is @yaks/ram, so a test composes exactly what a page would.

import { loadVocab, type Vocab } from '@yaks/vocab'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { type Mark, taskDoc, tasks } from '@yaks/task'
import { projectDoc } from './comp.ts'
import { projects } from './plugin.ts'

let doc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    person: { component: true, type: 'object', kind: true, properties: {} },
    // A lease, so a test can add the `wip` rung the way an application would.
    claim: {
      component: true,
      type: 'object',
      properties: {
        person: { type: 'string', ref: 'person', death: 'cascade' },
      },
    },
  },
}

/** The team's vocabulary: the portfolio, the tasks in it, `doc` and edges. */
export let team: Vocab = loadVocab(
  [docDoc, edgeDoc, taskDoc, projectDoc, doc],
  [edgeKeywords],
)

/** A fresh in-memory storage over that vocabulary. */
export let store = (): Storage => ram(team)

/** A graph over a fresh store, with the edge, task and portfolio plugins. */
export let teamGraph = (
  storage: Storage = store(),
  marks?: Mark[],
): { g: Graph; storage: Storage } => ({
  g: graph({
    storage,
    vocab: team,
    plugins: [edges(team), tasks(), projects(team, marks)],
  }),
  storage,
})
