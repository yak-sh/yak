// The status rule over bundles, and the same rule as SQL through a real SQLite
// store: every shape a transcript can be in answers the same word both ways.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { graph, identityEid } from '@yaks/graph'
import { col, eq, render, select, table, val } from '@yaks/sql'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { driver } from '../sqlite/native.ts'
import { effectsIn, loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { storage as held } from '@yaks/durable-object'
import { mem } from '../sqlite/testing.ts'
import { durable } from '../durable-object/testing.ts'
import { effectDoc } from '@yaks/effects'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
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

let vocab = loadVocab([sessionDoc, toolsDoc, modelDoc, kernelDoc, effectDoc], [
  kernelKeywords,
])
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
  ['a deliberate refusal is terminal without an ask', [
    request(1),
    entry(2, { refusal: { code: 'no_model' }, content: { body: 'no model' } }),
  ], 'failed'],
  ['a deliberate refusal after a completed ask is terminal', [
    request(1),
    entry(2, { ask: { through: 'e1' }, attempt: {} }),
    entry(3, {
      refusal: { code: 'http_400' },
      output: { source: 'e2' },
      content: { body: 'no' },
    }),
  ], 'failed'],
  ['new input during a deliberately refused ask still needs an answer', [
    request(1),
    entry(2, { ask: { through: 'e1' }, attempt: {} }),
    input(3),
    entry(4, {
      refusal: { code: 'http_400' },
      output: { source: 'e2' },
      content: { body: 'no' },
    }),
  ], 'pending'],
  ['an unassociated compaction refusal is terminal after fresh input', [
    request(1),
    entry(2, { ask: { through: 'e1' }, attempt: {} }),
    said(3, 'e2'),
    input(4),
    entry(5, {
      refusal: { code: 'compaction' },
      content: { body: 'empty summary' },
    }),
  ], 'failed'],
  ['a refusal only follows the ask its output names', [
    request(1),
    entry(2, { ask: { through: 'e1' }, attempt: {} }),
    input(3),
    entry(4, { ask: { through: 'e3' }, attempt: {} }),
    entry(5, { refusal: { code: 'http_400' }, output: { source: 'e2' } }),
  ], 'pending'],
  ['new input after a deliberate refusal allows recovery', [
    request(1),
    entry(2, { refusal: { code: 'no_model' }, content: { body: 'no model' } }),
    input(3),
  ], 'pending'],
  ['refusal prose does not count as fresh input after an ask', [
    request(1),
    entry(2, { ask: { through: 'e1' }, attempt: {} }),
    entry(3, {
      refusal: { code: 'http_400' },
      output: { source: 'e2' },
      content: { body: 'no' },
    }),
    said(4, 'e2'),
  ], 'settled'],
  ['a failure the provider may yet answer is pending: the pool asks again', [
    request(1),
    entry(2, {
      ask: { through: 'e1' },
      attempt: {},
      interrupted: { code: 'transport' },
      provisional: { note: 'Retry owed' },
    }),
    entry(3, {
      notice: {},
      output: { source: 'e2' },
      content: { body: 'responses: failed — unknown' },
    }),
  ], 'pending'],
  ['orphan historical interruption stays failed until fresh input', [
    request(1),
    entry(2, {
      interrupted: { code: 'transport' },
      failed: { reason: 'No recorded request' },
      content: { body: 'cut' },
    }),
  ], 'failed'],
  ['fresh input resumes orphan historical interruption', [
    request(1),
    entry(2, {
      interrupted: { code: 'transport' },
      failed: { reason: 'No recorded request' },
      content: { body: 'cut' },
    }),
    input(3),
  ], 'pending'],
  ['three generic interruptions exhaust retries', [
    request(1),
    entry(2, { ask: { through: 'e1' }, attempt: {}, interrupted: {} }),
    entry(3, { ask: { through: 'e1' }, attempt: {}, interrupted: {} }),
    entry(4, { ask: { through: 'e1' }, attempt: {}, interrupted: {} }),
  ], 'failed'],
  ['three pooled interruptions are still owed', [
    request(1),
    entry(2, { ask: { through: 'e1' }, attempt: {}, interrupted: {} }),
    entry(3, { ask: { through: 'e1' }, attempt: {}, interrupted: {} }),
    entry(4, {
      ask: { through: 'e1' },
      attempt: {},
      interrupted: {},
      provisional: { note: 'Retry owed' },
    }),
  ], 'pending'],
  ['fresh input resumes a terminal interruption', [
    request(1),
    entry(2, {
      ask: { through: 'e1' },
      attempt: {},
      interrupted: {},
      failed: { reason: 'No retry' },
    }),
    input(3),
  ], 'pending'],
  ['a completed response resets the interruption bound', [
    request(1),
    entry(2, { ask: { through: 'e1' }, attempt: {}, interrupted: {} }),
    entry(3, { ask: { through: 'e1' }, attempt: {} }),
    entry(4, { ask: { through: 'e1' }, attempt: {}, interrupted: {} }),
  ], 'pending'],
  ['interrupted response is failed until new input', [
    input(1),
    entry(2, {
      ask: { through: 'e1' },
      attempt: {},
      interrupted: { code: 'transport' },
      failed: { reason: 'No retry' },
    }),
    said(3, 'e2'),
    entry(4, {
      notice: {},
      content: { body: 'Response interrupted.' },
    }),
  ], 'failed'],
  ['input during interrupted response remains pending', [
    input(1),
    entry(2, {
      ask: { through: 'e1' },
      attempt: {},
      interrupted: { code: 'transport' },
      failed: { reason: 'No retry' },
    }),
    input(3),
    said(4, 'e2'),
    entry(5, {
      notice: {},
      content: { body: 'Response interrupted.' },
    }),
  ], 'pending'],

  ...(['400', '429'] as const).flatMap(
    (code): [string, Bundle[], TranscriptStatus][] => {
      let rejected = [
        input(1),
        entry(2, { ask: { through: 'e1' }, attempt: {} }),
        entry(3, {
          refusal: { code: `http_${code}` },
          output: { source: 'e2' },
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
          entry(5, { ask: { through: 'e4' }, attempt: {} }),
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
  ['input after an open call does not start another ask', [
    request(1),
    entry(2, { ask: { through: 'e1' } }),
    entry(3, { call: { to: T, source: 'e2' } }),
    input(4),
  ], 'running'],
  ['an interrupted call still owes its result', [
    request(1),
    entry(2, { ask: { through: 'e1' } }),
    entry(3, { call: { to: T, source: 'e2' }, execution: {}, interrupted: {} }),
    said(4, 'e2'),
  ], 'running'],
  ['a refusal remains terminal beside a held open call', [
    request(1),
    entry(2, { ask: { through: 'e1' } }),
    entry(3, { call: { to: T, source: 'e2' }, execution: { by: S } }),
    entry(4, { refusal: {}, output: { source: 'e2' } }),
  ], 'failed'],
  ['a completed old turn cannot keep the next turn running', [
    request(1),
    entry(2, { ask: { through: 'e1' }, attempt: {} }),
    entry(3, { call: { to: T, source: 'e2' }, interrupted: {} }),
    input(4),
    entry(5, { result: { call: 'e3' }, content: { body: 'cut' } }),
    entry(6, { ask: { through: 'e5' }, attempt: {} }),
    said(7, 'e6'),
  ], 'settled'],
  ['nothing', [], 'empty'],
  ['a request', [request(1)], 'pending'],
  // Nothing here asked the runner: a harness runs it, and its hooks record
  // what was typed and what came back. The answer is the harness's to give.
  ['an input nobody here answers', [input(1)], 'running'],
  ['a harness turn answered', [input(1), said(2, S)], 'settled'],
  ['a harness turn asked again', [input(1), said(2, S), input(3)], 'running'],
  [
    'an ask open',
    [input(1), entry(2, { ask: { to: M }, attempt: { by: S } })],
    'running',
  ],
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
  ['an abandoned call can recover after an exception', [
    input(1),
    entry(2, { ask: { to: M } }),
    entry(3, {
      call: { to: T, id: 'c1', source: 'e2' },
      execution: {},
    }),
    entry(4, { exception: {} }),
  ], 'running'],
  ['an exception on a held call remains failed', [
    input(1),
    entry(2, { ask: { to: M } }),
    entry(3, {
      call: { to: T, id: 'c1', source: 'e2' },
      execution: { by: S },
    }),
    entry(4, { exception: {} }),
  ], 'failed'],
  ['a request refused at its limit', [
    request(1),
    entry(2, { refusal: { code: 'limit' } }),
  ], 'failed'],
  ['new input after a limit', [
    request(1),
    entry(2, { refusal: { code: 'limit' } }),
    input(3),
  ], 'pending'],
]

test('statusOf reads the newest entry', () => {
  for (let [name, entries, want] of shapes) {
    assertEquals(statusOf(entries.toReversed()), want, name)
  }
})

// A whole tool-using turn, read as it lands. The runner appends an ask with
// everything the model said and asked for in one batch, so the prefixes below
// are the states a reader can actually see: running while the tool is owed an
// answer, and settled only at the last output, which asked for nothing.
test('a turn that uses a tool is running until its last output', () => {
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

test('kindOf: prose alone is an input, prose with an output is one', () => {
  assertEquals(kindOf(input(1)), 'input')
  assertEquals(kindOf(said(2, 'e1')), 'output')
  assertEquals(
    kindOf(entry(3, { result: { call: 'e2' }, content: { body: 'x' } })),
    'result',
  )
  assertEquals(
    kindOf(entry(4, { refusal: { code: 'x' }, content: { body: 'x' } })),
    'refusal',
  )
  assertEquals(
    kindOf(entry(5, { refusal: { code: 'x' }, content: { body: 'no' } })),
    'refusal',
  )
  assertEquals(kindOf(entry(6, {})), undefined)
})

let store = (): Graph => {
  let s = storage(mem(), vocab, { derived: sessionDerived(vocab) })
  s.install()
  let g = graph({ storage: s, vocab })
  g.apply([
    { entity: { eid: S }, session: { id: 'one' } },
    { entity: { eid: M }, model: { name: 'fake' } },
    { entity: { eid: T }, tool: { name: 'echo' } },
  ])
  return g
}

// One shape's transcript under eids of its own, every reference among them
// renamed too, so all the shapes share one store as sessions side by side.
let apart = (name: string, entries: Bundle[]): Bundle[] => {
  let eids = new Set([S, ...entries.map((b) => b.entity.eid)])
  let own = (v: unknown): unknown =>
    typeof v == 'string'
      ? eids.has(v) ? `${name}/${v}` : v
      : Array.isArray(v)
      ? v.map(own)
      : v && typeof v == 'object'
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, own(x)]))
      : v
  return [{ entity: { eid: S }, session: { id: name } }, ...entries]
    .map((b) => own(b) as Bundle)
}

for (let typed of [false, true]) {
  test(`the SQL view answers the same word as the rule (archetypes: ${typed})`, () => {
    let v = typed
      ? loadVocab([
        sessionDoc,
        toolsDoc,
        modelDoc,
        kernelDoc,
        effectDoc,
        archetypeDoc,
      ], [kernelKeywords])
      : vocab
    let storage1 = storage(mem(), v, { derived: sessionDerived(v) })
    storage1.install()
    let g = graph({ storage: storage1, vocab: v })
    g.apply([{ entity: { eid: M }, model: { name: 'fake' } }, {
      entity: { eid: T },
      tool: { name: 'echo' },
    }])
    g.apply(shapes.flatMap(([name, entries]) => apart(name, entries)), {
      trusted: true,
    })
    let want = Object.fromEntries(shapes.map(([name, , w]) => [name, w]))
    // Each word filters exactly the transcripts in that shape.
    for (let word of new Set(Object.values(want))) {
      let found = (g.read(`.session.status=${word}`) as Bundle[])
        .map((b) => (b.session as { id: string }).id).filter((id) =>
          id != 'one'
        )
      assertEquals(
        found.sort(),
        shapes.filter(([, , w]) => w == word).map(([name]) => name).sort(),
        `filters as ${word}`,
      )
    }
    // The two words this package owns. A host composing its own properties onto
    // `session` (the fleet does) reads those beside them, and they are its.
    let read = Object.fromEntries(
      (g.read('.session') as Bundle[]).map((b) => {
        let { id, status } = b.session as { id: string; status: string }
        return [id, status]
      }),
    )
    delete read.one
    assertEquals(read, want)
  })
}

// The status is computed from the entries, and an entity that is not a session
// at all has none: the model and the tool rows read `empty` too, so
// `.session.status=empty` answered with the whole graph (T-37730). A qualified
// path names the component as much as the property, and @yaks/sql says so for
// every derived read.
test('a status filter answers only the entities wearing session', () => {
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

test('one transcript stays settled beside other transcripts with open work', () => {
  let g = store()
  g.apply([
    { entity: { eid: 'open' }, session: { id: 'open' } },
    { entity: { eid: 'flight' }, session: { id: 'flight' } },
    { entity: { eid: 'abandoned' }, session: { id: 'abandoned' } },
    request(1),
    entry(2, { ask: { to: M } }),
    said(3, 'e2'),
    {
      entity: { eid: 'open-call' },
      entry: { session: 'open', seq: 1 },
      call: { to: T },
    },
    {
      entity: { eid: 'flight-attempt' },
      entry: { session: 'flight', seq: 1 },
      attempt: { by: S },
    },
    {
      entity: { eid: 'abandoned-call' },
      entry: { session: 'abandoned', seq: 1 },
      call: { to: T },
      execution: {},
    },
  ], { trusted: true })
  let [read] = g.get([S]) as Bundle[]
  assertEquals((read.session as { status: string }).status, 'settled')
  assertEquals(
    (g.read('.session.status=settled') as Bundle[]).map((b) => b.entity.eid),
    [S],
  )
})

test('usingBefore is the newest using at or before a seq', () => {
  let entries = [
    entry(1, { content: { body: 'a' }, using: { model: 'a' } }),
    entry(2, { ask: { to: 'a' }, using: { model: 'a' } }),
    entry(3, { content: { body: 'b' }, using: { model: 'b' } }),
  ]
  assertEquals(usingBefore(entries)?.model, 'b')
  assertEquals(usingBefore(entries, 2)?.model, 'a')
  assertEquals(usingBefore([input(1)]), undefined)
})

test('passive notices do not change settled, stopped or empty status', () => {
  let notice = entry(10, { notice: {}, content: { body: 'context' } })
  assertEquals(statusOf([notice]), 'empty')
  assertEquals(statusOf([said(3, 'e2'), notice]), 'settled')
  assertEquals(statusOf([entry(3, { stop: {} }), notice]), 'stopped')
})

test('a harness ending stays ended while its importer catches up, then clears on resume', () => {
  let g = store()
  g.apply([{ entity: { eid: S }, session: { ended: true } }])
  g.apply([input(1), said(2, S)], { trusted: true })
  assertEquals(statusOf([input(1), said(2, S)], true), 'stopped')
  assertEquals((g.read('.session.status=stopped') as Bundle[]).length, 1)
  g.apply([{ entity: { eid: S }, session: { ended: null } }])
  g.apply([input(3)], { trusted: true })
  assertEquals((g.read('.session.status=running') as Bundle[]).length, 1)
})

// Where an app's transcripts live, a Durable Object's SQLite, workerd refuses
// an expression past 100 deep, and the runner's sweep nests the status inside
// a union: the query a worker coming up asks for the turns nobody wrote down.
test("the runner's sweep finds a transcript owed a turn in a Durable Object", () => {
  let [run] = effectsIn(sessionDoc).filter((e) => e.name == 'session_run')
  let s = held(durable(), vocab, { derived: sessionDerived(vocab) })
  s.install()
  let g = graph({ storage: s, vocab })
  g.apply([
    { entity: { eid: S }, session: { id: 'one' } },
    { entity: { eid: 'idle' }, session: { id: 'idle' } },
    { entity: { eid: M }, model: { name: 'fake' } },
    request(1),
  ], { trusted: true })
  let owed = (g.read(run.sweep!) as Bundle[]).map((b) => b.entity.eid)
  assertEquals(owed, [S])
})

// SQLite's statement counters measure engine work, not the number of returned
// bundles. A transcript lookup returning one row used to visit its history.
test('a finished session status seeks its newest turn with bounded engine work', () => {
  let lib = Deno.dlopen(sqlitePath, {
    sqlite3_next_stmt: {
      parameters: ['pointer', 'pointer'],
      result: 'pointer',
    },
    sqlite3_stmt_status: {
      parameters: ['pointer', 'i32', 'i32'],
      result: 'i32',
    },
  })
  let db = new Database(':memory:')
  try {
    let d = driver(db)
    let s = storage(d, vocab, { derived: sessionDerived(vocab) })
    s.install()
    let g = graph({ storage: s, vocab })
    g.apply([{ entity: { eid: S }, session: { id: 'long' } }])
    let transcript = Array.from(
      { length: 3000 },
      (_, i) =>
        i % 3 == 0
          ? input(i + 1)
          : i % 3 == 1
          ? entry(i + 1, { ask: { through: `e${i}` }, attempt: {} })
          : said(i + 1, `e${i}`),
    )
    g.apply(transcript, { trusted: true })
    let [owner] = d.query(
      select({
        cols: [col('id')],
        from: table('entity'),
        where: eq(col('eid'), val(S)),
      }),
    )
    let query = select({
      cols: [
        sessionDerived(vocab)['session.status'].expr(val(Number(owner.id))),
      ],
    })
    let compiled = render(query)
    let plan = d.query({ t: 'explain query plan', of: query }).map((r) =>
      String(r.detail)
    ).join('\n')
    assert(plan.includes('entry_session_seq'), plan)
    assert(!/SCAN (?:entry|e)\b|USE TEMP B-TREE FOR ORDER BY/.test(plan), plan)
    let statement = db.prepare(compiled.sql)
    assertEquals(
      Object.values(statement.get(...compiled.params)!)[0],
      'settled',
    )
    // The statement just prepared is SQLite's newest live statement.
    let handle = lib.symbols.sqlite3_next_stmt(db.unsafeHandle, null)
    let steps = lib.symbols.sqlite3_stmt_status(handle, 4, 0)
    console.log('SESSION_STATUS_VM_STEPS', steps)
    assert(steps < 2000, `finished status executed ${steps} VM steps`)
    statement.finalize()
  } finally {
    db.close()
    lib.close()
  }
})
