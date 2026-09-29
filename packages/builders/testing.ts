// A small SQLite graph exercises the binding tree and the same tool runner
// that handles a builder's call in a host.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph, identityEid, type Tool } from '@yaks/graph'
import { type Effects, effects } from '@yaks/effects'
import { docDoc, docs } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { artifactDoc } from '@yaks/blob/vocab'
import { modelDoc } from '@yaks/model'
import { wakeDoc } from '@yaks/wake'
import { sessionDoc, sessions } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { type Runner, runner } from '@yaks/tools'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { builderDoc } from './vocab.ts'
import { type Options } from './build.ts'
import { watches } from './effects.ts'
import { modelTool } from './model.ts'

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
    cites: {
      component: true,
      type: 'object',
      edge: true,
      properties: { hash: { type: 'string' } },
    },
    verified: { component: true, type: 'object' },
    references: { component: true, type: 'object', edge: 'referenced' },
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

export let workshop = (more: VocabDoc[] = []): Vocab =>
  loadVocab([
    docDoc,
    edgeDoc,
    artifactDoc,
    modelDoc,
    wakeDoc,
    sessionDoc,
    toolsDoc,
    builderDoc,
    doc,
    ...more,
  ], [edgeKeywords])

export let noon = (): string => '2026-09-19T12:00:00.000Z'
export let ids = {
  builder: 'z-builder',
  source: 'z-source',
  model: identityEid('model', ['builder-test']),
  work: 'p-work',
}

export type Workshop = {
  g: Graph
  vocab: Vocab
  fx: Effects
  runner: Runner
  failed: unknown[]
}

export let shop = async (
  o: Omit<Options, 'vocab'> = {},
  more: VocabDoc[] = [],
  tools: Tool[] = [],
): Promise<Workshop> => {
  let vocab = workshop(more)
  let failed: unknown[] = []
  let fx = effects(vocab, {
    write: (b) => g.apply(b, { trusted: true }),
    report: (err) => void failed.push(err),
  })
  let db = storage(mem(), vocab)
  db.install()
  let g = graph({
    storage: db,
    vocab,
    plugins: [fx, docs(), edges(vocab), sessions()],
  })
  let run = runner(g, { tools: [modelTool(), ...tools] })
  fx.handle(watches({ ...o, vocab }))
  await run.ensure()
  await g.apply([
    { entity: { eid: ids.model }, model: { name: 'builder-test' } },
    { entity: { eid: ids.work }, project: { name: 'Work' } },
  ])
  return { g, vocab, fx, runner: run, failed }
}
