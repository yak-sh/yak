// What a step reads of a transcript is a bounded part of it that answers every
// question the step asks as the whole transcript would.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  type Bundle,
  type Comp,
  type Graph,
  graph,
  identityEid,
} from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { ram } from '@yaks/ram'
import { Archetypes } from '@yaks/archetype'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { effectDoc } from '@yaks/effects'
import { modelDoc } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { contextDoc } from '@yaks/context'
import { attemptComputed } from './attempt.ts'
import { sessionDoc } from './comp.ts'
import { askingOf, context, lines, recent } from './compact.ts'
import { sessions } from './plugin.ts'
import { openOf, reach, usingOf } from './reach.ts'
import { transcript } from './react.ts'
import {
  newestAsk,
  openCalls,
  sendingBefore,
  statusOf,
  usingBefore,
} from './state.ts'

let vocab = loadVocab(
  [
    kernelDoc,
    { $defs: { provisional: effectDoc.$defs!.provisional } },
    sessionDoc,
    toolsDoc,
    modelDoc,
    contextDoc,
  ],
  [kernelKeywords],
)

let M = identityEid('model', ['fake'])
let T = toolEid('echo')

let world = async (entries: Bundle[]) => {
  let storage = ram(vocab, { computed: attemptComputed })
  await storage.tx((tx) =>
    tx.patch([
      { entity: { eid: M }, model: { name: 'fake' } },
      { entity: { eid: T }, tool: { name: 'echo', description: 'say it' } },
      ...entries,
    ])
  )
  return graph({ storage, vocab, plugins: [sessions()] })
}

// A small seeded generator: the same seed is the same transcript.
let dice = (seed: number) => () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// A transcript in the shapes a runner leaves: inputs that choose a window,
// turns of asks answered by prose or by calls and their results, a call left
// open, stops, summaries and prompts, and a fork of a thick parent.
let script = (seed: number, size: number, forked = false): Bundle[] => {
  let roll = dice(seed)
  let pick = (n: number) => Math.floor(roll() * n)
  let seq = 0
  let out: Bundle[] = [{ entity: { eid: 's' }, session: {} }]
  let last = ''
  let line = (parts: Record<string, Comp>, owner: string): string => {
    let eid = `${owner}-${++seq}`
    out.push({ entity: { eid }, entry: { session: owner, seq }, ...parts })
    return eid
  }
  let marks = 0
  let turn = (owner: string) => {
    if (roll() < 0.4) line({ prompt: {}, content: { body: 'rule' } }, owner)
    last = line({
      content: { body: 'say ' + seq },
      using: { model: M },
      ...roll() < 0.5 ? { sending: { window: 3 + pick(8) } } : {},
    }, owner)
    for (let i = pick(6); i >= 0; i--) {
      let ask = line({
        ask: { to: M, through: last },
        using: { model: M },
        attempt: { by: null },
        ...roll() < 0.1 ? { interrupted: { code: 'transport' } } : {},
      }, owner)
      last = ask
      if (roll() < 0.5) {
        last = line({
          content: { body: 'reply ' + seq },
          output: { source: ask },
        }, owner)
        continue
      }
      for (let c = pick(3); c >= 0; c--) {
        let call = line({
          call: { to: T, id: 'c' + seq, source: ask },
          content: { body: '{}' },
        }, owner)
        let r = roll()
        // A background call left running: as written now, or with the
        // progress entry it was once answered by.
        if (r < 0.15) out.at(-1)!.tool_async = {}
        if (r < 0.075) {
          last = line(
            { tool_progress: { call }, content: { body: '...' } },
            owner,
          )
        } else if (r < 0.25) last = call
        else {
          last = line({
            result: { call },
            content: { body: 'ok' },
          }, owner)
        }
      }
    }
    if (roll() < 0.1) last = line({ stop: {} }, owner)
    if (roll() < 0.15 && out.length > 8) {
      let past = out.filter((b) => b.entry && !b.checkpoint)
      let through = past[pick(past.length)]
      last = line({
        checkpoint: {
          through: through.entity.eid,
          seq: (through.entry as Comp).seq,
          tasks: {},
        },
        notice: {},
        content: { body: 'summary ' + ++marks },
      }, owner)
    }
  }
  while (out.length < size) turn('s')
  if (!forked) return out
  // The child continues from the parent's newest ask-free line.
  let anchor = out.findLast((b) => b.output)!
  let parent = out
  // the child's lines come after the anchor's, as a fork's do
  out = [...parent, {
    entity: { eid: 'child' },
    session: {},
    fork: { from: anchor.entity.eid },
  }]
  while (out.length < parent.length + size / 2) turn('child')
  return out
}

// Everything a step asks of the entries, answered by eids.
let view = (entries: Bundle[]) => {
  let eids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)
  let said = lines(context(entries), askingOf(entries))
  let sending = sendingBefore(entries)
  return {
    status: statusOf(entries),
    asked: newestAsk(entries)?.entity.eid,
    open: eids(openCalls(entries)),
    using: usingBefore(entries),
    sending,
    asking: askingOf(entries)?.entity.eid,
    sent: eids(recent(said, sending?.window)),
  }
}

for (let forked of [false, true]) {
  for (let seed = 1; seed <= 4; seed++) {
    let g = await world(script(seed, 80, forked))
    let session = forked ? 'child' : 's'
    let whole = view(await transcript(g, session))
    // Capture the integration reads once; the case compares their answers to
    // the whole-transcript oracle, not the cost of composing that oracle.
    let got = view(await reach(g, session, { turn: true }))
    let bodies = view(await reach(g, session, { turn: true, bodies: true }))
    let status = view(await reach(g, session))
    let using = await usingOf(g, session)
    let open = (await openOf(g, session)).map((b) => b.entity.eid).sort()
    let expectedOpen = whole.open.toSorted()
    test(`a turn reads what the whole transcript would say (seed ${seed}, fork: ${forked})`, () => {
      for (let k of Object.keys(whole) as (keyof typeof whole)[]) {
        assertEquals(got[k], whole[k], k)
      }
      assertEquals(
        bodies,
        whole,
      )
      assertEquals(
        [status.status, status.open, status.using],
        [whole.status, whole.open, whole.using],
      )
      assertEquals(using, whole.using)
      assertEquals(
        open,
        expectedOpen,
      )
    })
  }
}

// Rows a read brings back, counted at the graph's door.
let counting = (g: Graph) => {
  let rows = 0, read = g.read.bind(g)
  g.read = async (q, o) => {
    let got = await read(q, o)
    rows += got.length
    return got
  }
  return () => rows
}

// A thousand lines of turns, then a window or a checkpoint that bounds what a
// model is sent.
let long = (bound: 'window' | 'checkpoint'): Bundle[] => {
  let out: Bundle[] = [{ entity: { eid: 's' }, session: {} }]
  for (let i = 1; i <= 400; i += 3) {
    out.push(
      {
        entity: { eid: 'in' + i },
        entry: { session: 's', seq: i },
        content: { body: 'go' },
        using: { model: M },
        ...bound == 'window' && i > 390 ? { sending: { window: 16 } } : {},
      },
      {
        entity: { eid: 'ask' + i },
        entry: { session: 's', seq: i + 1 },
        ask: { to: M, through: 'in' + i },
        using: { model: M },
        attempt: { by: null },
      },
      {
        entity: { eid: 'out' + i },
        entry: { session: 's', seq: i + 2 },
        content: { body: 'ok' },
        output: { source: 'ask' + i },
      },
    )
  }
  if (bound == 'checkpoint') {
    out.push({
      entity: { eid: 'mark' },
      entry: { session: 's', seq: 403 },
      checkpoint: { through: 'out352', seq: 354, tasks: {} },
      content: { body: 'summary' },
      notice: {},
    })
  }
  return out
}

for (let bound of ['window', 'checkpoint'] as const) {
  let g = await world(long(bound))
  let whole = view(await transcript(g, 's'))
  let rows = counting(g)
  // Keep separate row counts for both reads, including every production read.
  let before = rows()
  let turn = view(await reach(g, 's', { turn: true }))
  let turnRows = rows() - before
  before = rows()
  let status = statusOf(await reach(g, 's'))
  let statusRows = rows() - before
  test(`a status and a model turn read a bounded part of a long transcript (${bound})`, () => {
    assertEquals(turn, whole)
    assertEquals(turnRows < 120, true)
    assertEquals(status, 'settled')
    assertEquals(statusRows < 120, true)
  })
}

// Imported history can contain thousands of controls but no asks. Neither
// the first model request nor a completed first request owes a retry streak.
for (let completed of [false, true]) {
  let g = await world([
    { entity: { eid: 's' }, session: {} },
    ...Array.from({ length: 1024 }, (_, i): Bundle => ({
      entity: { eid: `retained-${i}` },
      entry: { session: 's' },
      content: { body: 'old control' },
      ...i % 2 ? { stop: {} } : { notice: {} },
    })),
    {
      entity: { eid: 'now' },
      entry: { session: 's', seq: 1 },
      content: { body: 'new turn' },
      using: { model: M },
      sending: { window: 1 },
    },
    ...completed
      ? [{
        entity: { eid: 'first-ask' },
        entry: { session: 's', seq: 2 },
        ask: { to: M, through: 'now' },
        using: { model: M },
        attempt: { by: null },
      }]
      : [],
  ])
  let whole = await transcript(g, 's')
  let loaded = 0, get = g.get.bind(g)
  g.get = async (...args) => {
    let rows = await get(...args)
    loaded += rows.length
    return rows
  }
  let bounded = await reach(g, 's', { turn: true })
  let reads = loaded
  let actual = view(bounded), expected = view(whole)
  let status = statusOf(bounded), expectedStatus = statusOf(whole)
  test(`legacy controls do not force retry history before a ${completed ? 'completed' : 'first'} ask`, () => {
    assertEquals(actual, expected)
    assertEquals(status, expectedStatus)
    assertEquals(reads < 200, true)
  })
}

// Recovery metadata is server-only, but a runner reads it to resume a paid
// request rather than classifying it as an anonymous interrupted call.
let recoveryVocab = loadVocab([...vocab.docs, archetypeDoc], [kernelKeywords])
let recoveryStorage = ram(recoveryVocab, { computed: attemptComputed })
let recoveryRows: Bundle[] = [
  { entity: { eid: 'private-session' }, session: {} },
  {
    entity: { eid: 'private-input' },
    entry: { session: 'private-session', seq: 1 },
    content: { body: 'ask' },
    using: { model: M },
  },
  {
    entity: { eid: 'private-ask' },
    entry: { session: 'private-session', seq: 2 },
    ask: { to: M, through: 'private-input' },
    attempt: { by: 'worker' },
    inference: { executor: 'paid', request: 'frozen', receipt: 'completed' },
    submitted: { at: '2026-10-01T00:00:00Z' },
  },
]
// Raw fixture writes include the same immutable shape descriptors the graph
// maintains in production. Missing pointers would trigger a whole-body fallback
// and hide whether the runner's selected-component gather kept private pins.
let recoveryShapes = new Archetypes()
await recoveryStorage.tx((tx) =>
  tx.patch(recoveryRows.flatMap((row) => {
    let shape = recoveryShapes.intern(
      Object.keys(row).filter((n) => n != 'entity'),
    )
    return [
      {
        entity: { eid: shape.eid },
        archetype: { tables: JSON.stringify(shape.tables) },
      },
      { ...row, entity: { ...row.entity, archetype: shape.eid } },
    ]
  }))
)
let privateAsk = graph({
  storage: recoveryStorage,
  vocab: recoveryVocab,
  plugins: [sessions()],
})
let privateEntries = await reach(privateAsk, 'private-session', { turn: true })
let privateReached = privateEntries.find((b) => b.entity.eid == 'private-ask')!
let privateWhole = view(await transcript(privateAsk, 'private-session'))
test('a runner reads server-only executor pins when gathering the newest ask', () => {
  assertEquals(view(privateEntries), privateWhole)
  assertEquals(privateEntries.map((b) => b.entity.eid), [
    'private-input',
    'private-ask',
  ])
  assertEquals(
    privateEntries.find((b) => b.entity.eid == 'private-input')?.content,
    {},
  )
  assertEquals(privateReached.inference, {
    executor: 'paid',
    request: 'frozen',
    receipt: 'completed',
  })
  assertEquals(privateReached.submitted, { at: '2026-10-01T00:00:00Z' })
})

// A selection read is not an execution read. Unrelated request authority can
// be unavailable without changing which model an earlier choice selected.
let selectionOnly = await world([
  { entity: { eid: 's' }, session: {} },
  {
    entity: { eid: 'choice' },
    entry: { session: 's', seq: 1 },
    using: { model: M, effort: 'high' },
  },
  {
    entity: { eid: 'late' },
    entry: { session: 's', seq: 2 },
    using: { model: M, effort: 'low' },
  },
  {
    entity: { eid: 'served' },
    entry: { session: 's', seq: 3 },
    ask: { through: 'choice' },
    using: { model: M, effort: 'high' },
  },
])
let selectionGet = selectionOnly.get.bind(selectionOnly)
selectionOnly.get = (ids, comps, options) => {
  if (comps?.includes('execution')) {
    throw new Error('model choice read execution authority')
  }
  return selectionGet(ids, comps, options)
}
let selectedModel = await usingOf(selectionOnly, 's').then(
  (value) => () => value,
  (error) => () => {
    throw error
  },
)
test('a late request keeps the newer selected model without reading execution authority', () => {
  assertEquals(selectedModel(), { model: M, effort: 'low' })
})

// Recent inputs break a retry streak even when prose bodies are not loaded.
// Their immutable content presence is enough to bound a status read.
let retryRows: Bundle[] = [
  { entity: { eid: 'retry-session' }, session: {} },
  ...Array.from({ length: 1024 }, (_, i): Bundle => ({
    entity: { eid: 'retry-input-' + i },
    entry: { session: 'retry-session', seq: i + 1 },
    content: { body: 'input' },
    using: { model: M },
  })),
  {
    entity: { eid: 'retry-ask' },
    entry: { session: 'retry-session', seq: 1025 },
    ask: { to: M, through: 'retry-input-1023' },
    interrupted: { code: 'transport' },
  },
]
let retryStorage = ram(recoveryVocab, { computed: attemptComputed })
let retryShapes = new Archetypes()
await retryStorage.tx((tx) =>
  tx.patch(retryRows.flatMap((row) => {
    let shape = retryShapes.intern(
      Object.keys(row).filter((n) => n != 'entity'),
    )
    return [
      {
        entity: { eid: shape.eid },
        archetype: { tables: JSON.stringify(shape.tables) },
      },
      { ...row, entity: { ...row.entity, archetype: shape.eid } },
    ]
  }))
)
let retryGraph = graph({
  storage: retryStorage,
  vocab: recoveryVocab,
  plugins: [sessions()],
})
let retryLoaded = 0, retryGet = retryGraph.get.bind(retryGraph)
retryGraph.get = async (...args) => {
  let rows = await retryGet(...args)
  retryLoaded += rows.length
  return rows
}
let retryReached = await reach(retryGraph, 'retry-session')
let retryStatus = statusOf(await transcript(retryGraph, 'retry-session'))
test('recent inputs bound an interrupted request without loading old prose', () => {
  assertEquals(statusOf(retryReached), 'pending')
  assertEquals(statusOf(retryReached), retryStatus)
  assertEquals(retryLoaded < 100, true)
  assertEquals(
    retryReached.find((b) => b.entity.eid == 'retry-input-1023')?.content,
    {},
  )
})
