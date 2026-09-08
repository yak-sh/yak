// The status rule over bundles, and the same rule as SQL through a real SQLite
// store: every shape a transcript can be in answers the same word both ways.

import { assertEquals } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/harness.ts'
import { sessionDoc } from './comp.ts'
import { nativeDoc } from './native.ts'
import {
  nativeDerived,
  statusOf,
  type TranscriptStatus,
  usingBefore,
} from './status.ts'

let vocab = loadVocab([sessionDoc, nativeDoc])

let S = 'sess'
let entry = (n: number, kind: Record<string, unknown>, text = ''): Bundle => ({
  entity: { eid: `e${n}` },
  entry: { session: S, seq: n, text },
  ...kind,
})

// Every shape, as the entries that make it.
let shapes: [string, Bundle[], TranscriptStatus][] = [
  ['nothing', [], 'empty'],
  ['an input', [entry(1, { input: {} })], 'pending'],
  ['a model call open', [
    entry(1, { input: {} }),
    entry(2, { call: { to: 'm' } }),
  ], 'running'],
  ['a tool call open', [
    entry(1, { input: {} }),
    entry(2, { call: { to: 'm', response_id: 'r' } }),
    entry(3, { call: { to: 't', id: 'c1', source: 'e2' } }),
  ], 'running'],
  ['a result', [
    entry(1, { input: {} }),
    entry(2, { call: { to: 'm' } }),
    entry(3, { call: { to: 't', id: 'c1', source: 'e2' } }),
    entry(4, { result: { call: 'e3' } }),
  ], 'pending'],
  ['an output', [
    entry(1, { input: {} }),
    entry(2, { call: { to: 'm' } }),
    entry(3, { output: { source: 'e2' } }),
  ], 'settled'],
  ['a stop', [entry(1, { input: {} }), entry(2, { stop: {} })], 'stopped'],
  [
    'an exception',
    [entry(1, { input: {} }), entry(2, { exception: {} })],
    'failed',
  ],
  [
    'one error',
    [entry(1, { input: {} }), entry(2, { error: { code: 'x' } })],
    'pending',
  ],
  ['three errors', [
    entry(1, { input: {} }),
    entry(2, { error: { code: 'x' } }),
    entry(3, { error: { code: 'x' } }),
    entry(4, { error: { code: 'x' } }),
  ], 'failed'],
]

Deno.test('statusOf reads the newest entry', () => {
  for (let [name, entries, want] of shapes) {
    assertEquals(statusOf(entries.toReversed()), want, name)
  }
})

let store = (): Graph => {
  let s = storage(mem(), vocab, { derived: nativeDerived })
  s.install()
  let g = graph({ storage: s, vocab })
  g.apply([
    { entity: { eid: S }, session: { id: 'one' }, transcript: {} },
    { entity: { eid: 'm' }, model: { name: 'fake' } },
    { entity: { eid: 't' }, tool: { name: 'echo' } },
  ])
  return g
}

Deno.test('the SQL view answers the same word as the rule', () => {
  for (let [name, entries, want] of shapes) {
    let g = store()
    if (entries.length) g.apply(entries, { trusted: true })
    let [s] = g.read(`.transcript.status=${want}`) as Bundle[]
    assertEquals(s?.entity.eid, S, `${name} filters as ${want}`)
    let [read] = g.read(`.transcript, .session.id=one`) as Bundle[]
    assertEquals(read.transcript, { status: want }, `${name} reads as ${want}`)
  }
})

Deno.test('usingBefore is the newest using at or before a seq', () => {
  let entries = [
    entry(1, { input: {}, using: { model: 'a' } }),
    entry(2, { call: { to: 'a' }, using: { model: 'a' } }),
    entry(3, { input: {}, using: { model: 'b' } }),
  ]
  assertEquals(usingBefore(entries)?.model, 'b')
  assertEquals(usingBefore(entries, 2)?.model, 'a')
  assertEquals(usingBefore([entry(1, { input: {} })]), undefined)
})
