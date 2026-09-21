// Shared test fixtures (not part of the published package — see deno.json): a
// small graph, called a notebook, with dreams in it.
//
// It holds one project and one persona, and loads the components a desk is
// written with — @yaks/session's session and claim, @yaks/doc's body text,
// @yaks/edge's links, @yaks/wake's schedules — alongside dreaming's own. The
// storage is @yaks/ram: a Map holding the bundles, with the same `apply()` and
// the same rules as a database. No process is started: a desk here is just the
// rows a server would hand to whatever runs sessions.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { type Effects, effects } from '@yaks/effects'
import { docDoc, docs } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { modelDoc } from '@yaks/model'
import { wakeDoc } from '@yaks/wake'
import { sessionDoc, sessions } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { dreamingDoc } from './vocab.ts'
import { type Open, watches } from './desk.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    project: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: {} },
    },
    // The persona a desk uses is @yaks/persona's; declared here, along with
    // `references`, so these tests need no dependency on that package.
    persona: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: {} },
    },
    references: { component: true, type: 'object', relation: 'referenced' },
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
    updated: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
  },
}

/** The notebook's vocabulary: dreaming's components, plus the ones a desk is
 * written with. */
export let notebook: Vocab = loadVocab([
  docDoc,
  edgeDoc,
  modelDoc,
  wakeDoc,
  sessionDoc,
  toolsDoc,
  dreamingDoc,
  doc,
], [edgeKeywords])

/** A clock that does not move, so a test can assert on what it stamped. */
export let noon = (): string => '2026-09-19T12:00:00.000Z'

/** The ids the tests share. */
export let ids = {
  work: 'p-work', // the project a dream is filed under
  voice: 'n-scribe', // the persona a desk runs with
  dream: 'z-writeup', // the standing intention
  house: 'y-house', // the provider this machine has
  mind: 'o-mind', // the model it serves
}

/** The whole rig: a graph over a fresh Map, and the effects watching it. */
export type Notebook = {
  /** the notebook's graph */
  g: Graph
  /** its effect registry, for a test that registers another handler */
  fx: Effects
  /** what a failing handler reported — recorded, never a failed
   * transaction */
  failed: unknown[]
}

/** A notebook with a project and a persona in it, watching for dreams the way
 * the `effects` export registers them. */
export let notes = async (o: Open): Promise<Notebook> => {
  let failed: unknown[] = []
  let fx = effects(notebook, {
    write: (b) => g.apply(b, { trusted: true }),
    report: (err) => void failed.push(err),
  })
  let g = graph({
    storage: ram(notebook),
    vocab: notebook,
    plugins: [fx, docs(), edges(notebook), sessions()],
  })
  for (let { comp, ...watch } of watches(o)) fx.on(comp, watch)
  await g.apply([
    { entity: { eid: ids.work }, project: { name: 'Work' } },
    { entity: { eid: ids.voice }, persona: { name: 'Scribe' } },
    { entity: { eid: ids.house }, provider: { name: 'house' } },
    { entity: { eid: ids.mind }, model: { name: 'mind', provider: ids.house } },
  ])
  return { g, fx, failed }
}

/** Eids in order, so a test can name the entities a desk created. */
export let counter = (): () => string => {
  let n = 0
  return () => `new-${++n}`
}
