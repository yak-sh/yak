// Shared test fixtures (not part of the published package — see deno.json): a
// notebook that dreams.
//
// One project, one voice to wear, and a graph that speaks the words a desk is
// written in — @yaks/session's transcript and lock, @yaks/doc's words,
// @yaks/edge's link, @yaks/wake's schedule — beside dreaming's own. The store
// is @yaks/ram: a Map holding the bundles, the same `apply()` and the same
// rules as a database. Nothing spawns: a desk here is the rows a host would
// hand to whoever runs sessions.

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
    // The voice a desk wears is @yaks/persona's; said here so these tests need
    // no dependency on that package, and `references` with it.
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

/** The notebook's vocabulary: dreaming's words, and the ones a desk is
 * written in. */
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
  voice: 'n-scribe', // the persona a desk wears
  dream: 'z-writeup', // the standing intention
  house: 'y-house', // the provider this box has
  mind: 'o-mind', // the model it serves
}

/** The whole rig: a graph over a fresh Map, and the effects watching it. */
export type Notebook = {
  /** the notebook's graph */
  g: Graph
  /** its effect registry, for a test that registers another handler */
  fx: Effects
  /** what a failing handler reported — telemetry, never a broken batch */
  failed: unknown[]
}

/** A notebook with a project and a voice in it, watching for dreams the way
 * the `effects` facet registers them. */
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

/** Eids in order, so a test can name what the desk minted. */
export let counter = (): () => string => {
  let n = 0
  return () => `new-${++n}`
}
