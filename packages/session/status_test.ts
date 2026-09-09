// The status rule over bundles, and the same rule as SQL through a real SQLite
// store: every shape a transcript can be in answers the same word both ways.

import { assertEquals } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/harness.ts'
import { modelDoc } from '@yaks/model'
import { sessionDoc } from './comp.ts'
import {
  kindOf,
  sessionDerived,
  statusOf,
  type TranscriptStatus,
  usingBefore,
} from './status.ts'

let vocab = loadVocab([sessionDoc, modelDoc])

let S = 'sess'
let entry = (n: number, kind: Record<string, unknown>): Bundle => ({
  entity: { eid: `e${n}` },
  entry: { session: S, seq: n },
  ...kind,
})
let input = (n: number) => entry(n, { content: { body: 'hi' } })
let said = (n: number, source: string) =>
  entry(n, { content: { body: 'done', source } })

// Every shape, as the entries that make it.
let shapes: [string, Bundle[], TranscriptStatus][] = [
  ['nothing', [], 'empty'],
  ['an input', [input(1)], 'pending'],
  ['an ask open', [input(1), entry(2, { ask: { to: 'm' } })], 'running'],
  ['a tool call open', [
    input(1),
    entry(2, { ask: { to: 'm' } }),
    entry(3, { call: { to: 't', id: 'c1', source: 'e2' } }),
  ], 'running'],
  ['a result', [
    input(1),
    entry(2, { ask: { to: 'm' } }),
    entry(3, { call: { to: 't', id: 'c1', source: 'e2' } }),
    entry(4, { result: { call: 'e3' }, content: { body: 'echo' } }),
  ], 'pending'],
  [
    'an output',
    [input(1), entry(2, { ask: { to: 'm' } }), said(3, 'e2')],
    'settled',
  ],
  // The model said something and then asked for a tool: the prose is the
  // newest entry, and the run is not over (T-35230).
  ['prose beside an open call', [
    input(1),
    entry(2, { ask: { to: 'm' } }),
    said(3, 'e2'),
    entry(4, { call: { to: 't', id: 'c1', source: 'e2' } }),
  ], 'running'],
  ['prose beside an answered call', [
    input(1),
    entry(2, { ask: { to: 'm' } }),
    said(3, 'e2'),
    entry(4, { call: { to: 't', id: 'c1', source: 'e2' } }),
    entry(5, { result: { call: 'e4' }, content: { body: 'echo' } }),
  ], 'pending'],
  ['a stop', [input(1), entry(2, { stop: {} })], 'stopped'],
  ['an exception', [input(1), entry(2, { exception: {} })], 'failed'],
  ['one error', [input(1), entry(2, { error: { code: 'x' } })], 'pending'],
  ['three errors', [
    input(1),
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

// A whole tool-using turn, read as it lands. The daemon appends an ask with
// everything the model said and asked for in ONE batch, so the prefixes below
// are the states a reader can actually see: running while the tool is owed an
// answer, and settled only at the last output, which asked for nothing.
Deno.test('a turn that uses a tool is running until its last output', () => {
  let turn = [
    input(1),
    entry(2, { ask: { to: 'm' } }),
    said(3, 'e2'), // the model's prose, before its call
    entry(4, { call: { to: 't', id: 'c1', source: 'e2' } }),
    entry(5, { result: { call: 'e4' }, content: { body: 'echo' } }),
    entry(6, { ask: { to: 'm' } }),
    said(7, 'e6'),
  ]
  let want: TranscriptStatus[] = ['pending', 'running', 'pending', 'settled']
  for (let [i, upto] of [1, 4, 5, 7].entries()) {
    assertEquals(statusOf(turn.slice(0, upto)), want[i], `through ${upto}`)
  }
})

Deno.test('kindOf: prose alone is an input, prose with a source is an output', () => {
  assertEquals(kindOf(input(1)), 'input')
  assertEquals(kindOf(said(2, 'e1')), 'output')
  assertEquals(
    kindOf(entry(3, { result: { call: 'e2' }, content: { body: 'x' } })),
    'result',
  )
  assertEquals(
    kindOf(entry(4, { error: { code: 'x' }, content: { body: 'x' } })),
    'error',
  )
  assertEquals(kindOf(entry(5, {})), undefined)
})

let store = (): Graph => {
  let s = storage(mem(), vocab, { derived: sessionDerived })
  s.install()
  let g = graph({ storage: s, vocab })
  g.apply([
    { entity: { eid: S }, session: { id: 'one' } },
    { entity: { eid: 'm' }, model: { name: 'fake' } },
    { entity: { eid: 't' }, tool: { name: 'echo' } },
  ])
  return g
}

Deno.test('the SQL view answers the same word as the rule', () => {
  for (let [name, entries, want] of shapes) {
    let g = store()
    if (entries.length) g.apply(entries, { trusted: true })
    let [s] = g.read(`.session.status=${want}`) as Bundle[]
    assertEquals(s?.entity.eid, S, `${name} filters as ${want}`)
    let [read] = g.read(`.session.id=one`) as Bundle[]
    assertEquals(
      read.session,
      { id: 'one', status: want },
      `${name} reads as ${want}`,
    )
  }
})

Deno.test('usingBefore is the newest using at or before a seq', () => {
  let entries = [
    entry(1, { content: { body: 'a' }, using: { model: 'a' } }),
    entry(2, { ask: { to: 'a' }, using: { model: 'a' } }),
    entry(3, { content: { body: 'b' }, using: { model: 'b' } }),
  ]
  assertEquals(usingBefore(entries)?.model, 'b')
  assertEquals(usingBefore(entries, 2)?.model, 'a')
  assertEquals(usingBefore([input(1)]), undefined)
})
