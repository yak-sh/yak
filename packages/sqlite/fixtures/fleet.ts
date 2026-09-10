// Shared, deterministic package test/bench corpus. No database or timers here.
import type { Bundle } from '@yaks/graph'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { loadVocab } from '@yaks/vocab'
import { derived, MARKS, statusOf } from '@yaks/task'
import { fields, search } from '@yaks/fts'
import { traverse } from '@yaks/edge'

export const WORKLOAD_VERSION = 1
export const SEED = 0x36756
export const TASKS = 2048
export const BATCH_SIZE = 100
export const CHAIN = 64
export const eid = (n: number) =>
  `b3675600-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

// A deliberately small fleet vocabulary, not a snapshot of the server schema.
// Status is derived from the same marks as fleet, never stored as a shortcut.
export const vocab = loadVocab([edgeDoc, {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number' } },
    },
    doc: {
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    task: {
      type: 'object',
      properties: {
        status: { enum: ['open', 'wip', 'done', 'cancelled'], persist: false },
      },
    },
    session: { type: 'object', properties: { id: { type: 'string' } } },
    claim: {
      type: 'object',
      properties: {
        session: { type: 'string', ref: 'session', death: 'release' },
      },
    },
    completed: { type: 'object' },
    cancelled: { type: 'object' },
    requires: { type: 'object', relation: true },
    contains: { type: 'object', relation: true },
  },
}], [edgeKeywords])
export const textFields = fields(vocab, (c) => c.comp == 'doc')
const marks = [...MARKS, { status: 'wip', comp: 'claim', settled: false }]
export const options = {
  derived: derived(marks),
  extend: [search(textFields), traverse(vocab)],
}

export function workload() {
  let state = SEED
  let random = () => state = (Math.imul(state, 1664525) + 1013904223) >>> 0
  let tasks: Bundle[] = Array.from({ length: TASKS }, (_, i) => {
    let mark = random() % 16
    return {
      entity: { eid: eid(i + 1) },
      doc: {
        title: `Ratchet task ${i}`,
        body: `Deterministic graph workload ${i}: ${
          i % 32 == 0 ? 'flugelbinder' : 'ordinary'
        } dependencies and throughput.`,
      },
      task: {},
      ...(mark < 3
        ? { completed: {} }
        : mark == 3
        ? { claim: { session: eid(0) } }
        : {}),
    }
  })
  let bundles: Bundle[] = [
    {
      entity: { eid: eid(0) },
      session: { id: 'bench-ratchet-session' },
      doc: { title: 'Ratchet session' },
    },
    ...tasks,
    ...tasks.flatMap((t, i) => [
      link(eid(0), 'contains', t.entity.eid),
      ...(i % CHAIN ? [link(t.entity.eid, 'requires', eid(i))] : []),
    ]),
  ]
  let queries = [
    { name: 'point', query: `.entity.eid=${eid(1000)}`, expected: [eid(1000)] },
    {
      name: 'status-open',
      query: '.task.status=open',
      expected: tasks.filter((t) => statusOf(t, marks) == 'open').map((t) =>
        t.entity.eid
      ),
    },
    {
      name: 'fts',
      query: 'flugelbinder',
      expected: tasks.filter((_, i) => i % 32 == 0).map((t) => t.entity.eid),
    },
    {
      name: 'walk-16',
      query: `.requires[<=16]->${eid(1)}`,
      expected: Array.from({ length: 16 }, (_, i) => eid(i + 2)),
    },
    {
      name: 'walk-unbounded',
      query: `.requires->${eid(1)}`,
      expected: Array.from({ length: CHAIN - 1 }, (_, i) => eid(i + 2)),
    },
  ]
  // Two fixed batches alternate: every measured apply changes all 100 cells,
  // without growing the entity/edge corpus or changing query memberships.
  let batches = [0, 1].map((phase) =>
    tasks.slice(0, BATCH_SIZE).map((t, i) => ({
      entity: t.entity,
      doc: { title: `Ratchet updated ${phase} task ${i}` },
    }))
  )
  return { bundles, queries, batches }
}
export const OPERATIONS = [
  'point',
  'status-open',
  'fts',
  'walk-16',
  'walk-unbounded',
  'apply-100',
]
export const LAYERS = ['sqlite', 'sql', 'query', 'fleet'] as const
export const MODES = ['memory', 'file'] as const
export const benchmarkNames = () =>
  LAYERS.flatMap((layer) =>
    MODES.flatMap((mode) => OPERATIONS.map((op) => `${layer}/${mode}/${op}`))
  )
