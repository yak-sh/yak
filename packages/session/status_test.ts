// The status rule over bundles, and the same rule as SQL through a real SQLite
// store: every shape a transcript can be in answers the same word both ways.

import { assertEquals } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { graph, identityEid } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { modelDoc } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { toolEid } from '@yaks/tools'
import { sessionDoc } from './comp.ts'
import {
  kindOf,
  sessionDerived,
  statusOf,
  type TranscriptStatus,
  usingBefore,
} from './status.ts'

let vocab = loadVocab([sessionDoc, toolsDoc, modelDoc])
let M = identityEid('model', ['fake'])
let T = toolEid('echo')

let S = 'sess'
let entry = (n: number, kind: Record<string, unknown>): Bundle => ({
  entity: { eid: `e${n}` },
  entry: { session: S, seq: n },
  ...kind,
})
let input = (n: number) => entry(n, { content: { body: 'hi' } })
// The input that asks the runner: prose with the model it wants.
let request = (n: number) =>
  entry(n, { content: { body: 'hi' }, using: { model: M } })
let said = (n: number, source: string) =>
  entry(n, { content: { body: 'done' }, output: { source } })

// Every shape, as the entries that make it.
let shapes: [string, Bundle[], TranscriptStatus][] = [
  ['interrupted response is failed until new input', [
    input(1),
    entry(2, { ask: { through: 'e1' }, attempt: { state: 'interrupted' } }),
    said(3, 'e2'),
    entry(4, {
      error: { code: 'interrupted' },
      content: { body: 'Response interrupted.' },
    }),
  ], 'failed'],
  ['input during interrupted response remains pending', [
    input(1),
    entry(2, { ask: { through: 'e1' }, attempt: { state: 'interrupted' } }),
    input(3),
    said(4, 'e2'),
    entry(5, {
      error: { code: 'interrupted' },
      content: { body: 'Response interrupted.' },
    }),
  ], 'pending'],

  ...(['400', '429'] as const).flatMap(
    (code): [string, Bundle[], TranscriptStatus][] => {
      let rejected = [
        input(1),
        entry(2, { ask: { through: 'e1' }, attempt: { state: 'interrupted' } }),
        entry(3, {
          error: { code: 'interrupted' },
          content: { body: `Response interrupted: ModelError: ${code}` },
        }),
      ]
      return [
        [`provider ${code} rejection is failed`, rejected, 'failed'],
        [
          `new input after ${code} allows recovery`,
          [...rejected, input(4)],
          'pending',
        ],
        [`successful response after ${code} clears failure`, [
          ...rejected,
          input(4),
          entry(5, { ask: { through: 'e4' }, attempt: { state: 'completed' } }),
          said(6, 'e5'),
        ], 'settled'],
      ]
    },
  ),

  ['input arriving during ask remains pending after response', [
    input(1),
    entry(2, { ask: { to: M, through: 'e1' } }),
    input(3),
    said(4, 'e2'),
  ], 'pending'],
  ['subsequent ask acknowledges new input', [
    input(1),
    entry(2, { ask: { to: M, through: 'e1' } }),
    input(3),
    said(4, 'e2'),
    entry(5, { ask: { to: M, through: 'e4' } }),
    said(6, 'e5'),
  ], 'settled'],
  ['nothing', [], 'empty'],
  ['a request', [request(1)], 'pending'],
  // Nothing here asked the runner: a harness runs it, and its hooks record
  // what was typed and what came back. The answer is the harness's to give.
  ['an input nobody here answers', [input(1)], 'running'],
  ['a harness turn answered', [input(1), said(2, S)], 'settled'],
  ['a harness turn asked again', [input(1), said(2, S), input(3)], 'running'],
  ['an ask open', [input(1), entry(2, { ask: { to: M } })], 'running'],
  ['a tool call open', [
    input(1),
    entry(2, { ask: { to: M } }),
    entry(3, { call: { to: T, id: 'c1', source: 'e2' } }),
  ], 'running'],
  ['a result', [
    input(1),
    entry(2, { ask: { to: M } }),
    entry(3, { call: { to: T, id: 'c1', source: 'e2' } }),
    entry(4, { result: { call: 'e3' }, content: { body: 'echo' } }),
  ], 'pending'],
  [
    'an output',
    [input(1), entry(2, { ask: { to: M } }), said(3, 'e2')],
    'settled',
  ],
  // The model said something and then asked for a tool: the prose is the
  // newest entry, and the run is not over (T-35230).
  ['prose beside an open call', [
    input(1),
    entry(2, { ask: { to: M } }),
    said(3, 'e2'),
    entry(4, { call: { to: T, id: 'c1', source: 'e2' } }),
  ], 'running'],
  ['prose beside an answered call', [
    input(1),
    entry(2, { ask: { to: M } }),
    said(3, 'e2'),
    entry(4, { call: { to: T, id: 'c1', source: 'e2' } }),
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
  ['a request refused at its limit', [
    request(1),
    entry(2, { error: { code: 'limit' } }),
  ], 'failed'],
  ['new input after a limit', [
    request(1),
    entry(2, { error: { code: 'limit' } }),
    input(3),
  ], 'pending'],
]

Deno.test('statusOf reads the newest entry', () => {
  for (let [name, entries, want] of shapes) {
    assertEquals(statusOf(entries.toReversed()), want, name)
  }
})

// A whole tool-using turn, read as it lands. The runner appends an ask with
// everything the model said and asked for in one batch, so the prefixes below
// are the states a reader can actually see: running while the tool is owed an
// answer, and settled only at the last output, which asked for nothing.
Deno.test('a turn that uses a tool is running until its last output', () => {
  let turn = [
    request(1),
    entry(2, { ask: { to: M } }),
    said(3, 'e2'), // the model's prose, before its call
    entry(4, { call: { to: T, id: 'c1', source: 'e2' } }),
    entry(5, { result: { call: 'e4' }, content: { body: 'echo' } }),
    entry(6, { ask: { to: M } }),
    said(7, 'e6'),
  ]
  let want: TranscriptStatus[] = ['pending', 'running', 'pending', 'settled']
  for (let [i, upto] of [1, 4, 5, 7].entries()) {
    assertEquals(statusOf(turn.slice(0, upto)), want[i], `through ${upto}`)
  }
})

Deno.test('kindOf: prose alone is an input, prose with an output is one', () => {
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
    { entity: { eid: M }, model: { name: 'fake' } },
    { entity: { eid: T }, tool: { name: 'echo' } },
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
    // The two words this package owns. A host composing its own properties onto
    // `session` (the fleet does) reads those beside them, and they are its.
    let { id, status } = read.session as { id: string; status: string }
    assertEquals({ id, status }, { id: 'one', status: want }, `${name} reads`)
  }
})

// The status is computed from the entries, and an entity that is not a session
// at all has none: the model and the tool rows read `empty` too, so
// `.session.status=empty` answered with the whole graph (T-37730). A qualified
// path names the component as much as the property, and @yaks/sql says so for
// every derived read.
Deno.test('a status filter answers only the entities wearing session', () => {
  let g = store()
  let eids = (q: string) => (g.read(q) as Bundle[]).map((b) => b.entity.eid)
  assertEquals(eids('.session.status=empty'), [S])
  // and a session that has entries leaves the empty answer, without the
  // model and the tool ever joining it
  g.apply([request(1)], { trusted: true })
  assertEquals(eids('.session.status=empty'), [])
  assertEquals(eids('.session.status=pending'), [S])
  // `!over`, the way the harness asks for the sessions still going
  assertEquals(eids('.session&.session.status!=settled,stopped,failed'), [S])
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

Deno.test('passive notices do not change settled, stopped or empty status', () => {
  let notice = entry(10, { notice: {}, content: { body: 'context' } })
  assertEquals(statusOf([notice]), 'empty')
  assertEquals(statusOf([said(3, 'e2'), notice]), 'settled')
  assertEquals(statusOf([entry(3, { stop: {} }), notice]), 'stopped')
})
