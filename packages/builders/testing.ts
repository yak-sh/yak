// Shared test fixtures (not part of the published package — see deno.json): a
// small graph, called a workshop, with builders in it.
//
// It holds one persona, a provider serving one model, and loads the components
// a build is written with — @yaks/session's session and entries, @yaks/doc's
// body text, @yaks/edge's links, @yaks/wake's schedules — alongside the
// builders' own. The storage is @yaks/ram: a Map holding the bundles, with the
// same `apply()` and the same rules as a database. No process is started: a
// build here is just the rows a server would hand to whatever runs sessions.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph, identityEid } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { type Effects, effects } from '@yaks/effects'
import { docDoc, docs } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { modelDoc } from '@yaks/model'
import { wakeDoc } from '@yaks/wake'
import { sessionDoc, sessions } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { builderDoc } from './vocab.ts'
import type { Open } from './build.ts'
import { watches } from './effects.ts'

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
      properties: { name: { type: 'string' } },
    },
    // The persona a build uses is @yaks/persona's, and `references` and
    // `reads` are @yaks/kernel's; declared here so these tests need no
    // dependency on either package.
    persona: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: { type: 'string' } },
    },
    references: { component: true, type: 'object', edge: 'referenced' },
    reads: { component: true, type: 'object', edge: 'reads' },
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

/** The workshop's vocabulary: the builders' components, the ones a build is
 * written with, and any `more` a caller composes beside them. */
export let workshop = (more: VocabDoc[] = []): Vocab =>
  loadVocab([
    docDoc,
    edgeDoc,
    modelDoc,
    wakeDoc,
    sessionDoc,
    toolsDoc,
    builderDoc,
    doc,
    ...more,
  ], [edgeKeywords])

/** A clock that does not move, so a test can assert on what it stamped. */
export let noon = (): string => '2026-09-19T12:00:00.000Z'

/** The ids the tests share. */
export let ids = {
  work: 'p-work', // a project
  voice: 'n-scribe', // the persona a build runs with
  builder: 'z-writeup', // the builder
  house: identityEid('provider', ['house']), // the provider this machine has
  mind: identityEid('model', ['mind']), // the model it serves
  other: identityEid('model', ['other']), // a second model it serves
}

/** The whole rig: a graph over a fresh Map, and the effects watching it. */
export type Workshop = {
  /** the workshop's graph */
  g: Graph
  /** its vocabulary */
  vocab: Vocab
  /** its effect registry, for a test that registers another handler */
  fx: Effects
  /** what a failing handler reported — recorded, never a failed
   * transaction */
  failed: unknown[]
}

/** A workshop with a persona and a provider in it, watching for builders the
 * way the `effects` export registers them. */
export let shop = async (
  o: Omit<Open, 'vocab'>,
  more: VocabDoc[] = [],
): Promise<Workshop> => {
  let vocab = workshop(more)
  let failed: unknown[] = []
  let fx = effects(vocab, {
    write: (b) => g.apply(b, { trusted: true }),
    report: (err) => void failed.push(err),
  })
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [fx, docs(), edges(vocab), sessions()],
  })
  fx.handle(watches({ ...o, vocab }))
  await g.apply([
    { entity: { eid: ids.work }, project: { name: 'Work' } },
    { entity: { eid: ids.voice }, persona: { name: 'Scribe' } },
    { entity: { eid: ids.house }, provider: { name: 'house' } },
    { entity: { eid: ids.mind }, model: { name: 'mind' } },
    { entity: { eid: ids.other }, model: { name: 'other' } },
    { ...link(ids.house, 'serves', ids.mind), serves: { name: 'mind' } },
    { ...link(ids.house, 'serves', ids.other), serves: { name: 'other' } },
  ])
  return { g, vocab, fx, failed }
}

/** Eids in order, so a test can name the entities a build created. */
export let counter = (): () => string => {
  let n = 0
  return () => `new-${++n}`
}
