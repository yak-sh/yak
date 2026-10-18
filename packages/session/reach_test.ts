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
        if (r < 0.15) {
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
    test(`a turn reads what the whole transcript would say (seed ${seed}, fork: ${forked})`, async () => {
      let g = await world(script(seed, 80, forked))
      let session = forked ? 'child' : 's'
      let whole = view(await transcript(g, session))
      let got = view(await reach(g, session, { turn: true }))
      for (let k of Object.keys(whole) as (keyof typeof whole)[]) {
        assertEquals(got[k], whole[k], k)
      }
      assertEquals(
        view(await reach(g, session, { turn: true, bodies: true })),
        whole,
      )
      let status = view(await reach(g, session))
      assertEquals(
        [status.status, status.open, status.using],
        [whole.status, whole.open, whole.using],
      )
      assertEquals(await usingOf(g, session), whole.using)
      assertEquals(
        (await openOf(g, session)).map((b) => b.entity.eid).sort(),
        whole.open.toSorted(),
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
  test(`a status and a model turn read a bounded part of a long transcript (${bound})`, async () => {
    let g = await world(long(bound))
    let rows = counting(g)
    let whole = view(await transcript(g, 's'))
    let before = rows()
    let turn = await reach(g, 's', { turn: true })
    assertEquals(view(turn), whole)
    assertEquals(rows() - before < 120, true)
    before = rows()
    assertEquals(statusOf(await reach(g, 's')), 'settled')
    assertEquals(rows() - before < 120, true)
  })
}
