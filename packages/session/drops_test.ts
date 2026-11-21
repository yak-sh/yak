// A session that drops leaves out the calls, results and worker reports it has
// replied past: when its provider's cache is cold, and where a summary would
// be written while warm. No model is asked, and every row stays readable.
import { equal, test } from '@yaks/testing'
import { type Bundle, graph, identityEid } from '@yaks/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { effectDoc } from '@yaks/effects'
import { type Model, modelDoc, type Reply, type Request } from '@yaks/model'
import { executionComputed, toolEid } from '@yaks/tools'
import { toolsDoc } from '@yaks/tools/vocab'
import { contextDoc } from '@yaks/context'
import { taskDoc } from '@yaks/task/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { attemptComputed } from './attempt.ts'
import { seedIdentities } from './testing.ts'
import { settle } from './run.ts'
import { transcript } from './transcript.ts'
import {
  answered,
  elide,
  elidedBefore,
  nextElision,
  replied,
} from './pruning.ts'
import { type Kind, kindOf, pastCache } from './state.ts'

let line = (seq: number, comps: object): Bundle => ({
  entity: { eid: `l${seq}` },
  entry: { session: 's', seq },
  ...comps,
})
let ids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)

// One turn: a call answered, a child's report, then the reply that read both;
// after it a call still running, and one answered since.
let turn = [
  line(1, { content: { body: 'Jeff: look into it' } }),
  line(2, { ask: {} }),
  line(3, { call: {} }),
  line(4, { result: { call: 'l3' }, content: { body: 'found' } }),
  line(5, { delivery: { child: 'c' }, content: { body: 'child settled' } }),
  line(6, { ask: {} }),
  line(7, { output: { source: 'l6' }, content: { body: 'It is fixed.' } }),
  line(8, { call: {} }),
  line(9, { call: {} }),
  line(10, { tool_progress: { call: 'l8' } }),
  line(11, { result: { call: 'l9' } }),
]

test('what came before the request the newest reply answered is dropped: calls with their answers, and reports', () => {
  equal(replied(turn, 's'), 6)
  equal(ids(answered(turn, 6)), ['l3', 'l4', 'l5'])
})

test('what a worker wrote through the bus is its report; a person\u2019s words through it stay', () => {
  let heard = [
    line(1, { attention: { worker: 'w' }, content: { body: 'knock: done' } }),
    line(2, { attention: {}, content: { body: 'comment from Jeff: wait' } }),
    line(3, { ask: {} }),
    line(4, { output: { source: 'l3' } }),
  ]
  equal(ids(answered(heard, replied(heard, 's')!)), ['l1'])
})

test('a call still running, or answered since the reply, stays with every answer to it', () => {
  let early = [
    line(1, { call: {} }),
    line(2, { tool_progress: { call: 'l1' } }),
    line(3, { call: {} }),
    line(4, { ask: {} }),
    line(5, { output: { source: 'l4' } }),
    line(6, { result: { call: 'l3' } }),
  ]
  equal(ids(answered(early, replied(early, 's')!)), [])
})

test('a session that has said nothing of its own has replied to nothing', () => {
  equal(replied(turn.slice(0, 5), 's'), undefined)
  equal(
    replied([
      ...turn.slice(0, 6),
      line(7, {
        output: { source: 'l6' },
        reasoning: {},
      }),
    ], 's'),
    undefined,
  )
})

test('a cold projection keeps the current turn, whole dialog, and open calls', () => {
  let rows = [
    line(1, { content: { body: 'first person message' } }),
    line(2, { prompt: { scope: 'turn' }, content: { body: 'old presence' } }),
    line(3, { prompt: { scope: 'turn' }, content: { body: 'opened Read' } }),
    line(4, { prompt: {}, content: { body: 'standing instructions' } }),
    line(5, { call: {} }),
    line(6, { result: { call: 'l5' }, content: { body: 'tool text' } }),
    line(7, { call: {} }),
    line(8, { tool_progress: { call: 'l7' } }),
    line(9, { ask: {} }),
    line(10, { output: { source: 'l9' }, content: { body: 'whole reply' } }),
    line(11, { content: { body: 'current person message' } }),
    line(12, { prompt: { scope: 'turn' }, content: { body: 'new presence' } }),
    line(13, { call: {} }),
    line(14, { result: { call: 'l13' } }),
  ]
  let original = structuredClone(rows)
  let before = nextElision(rows, 's')
  equal(ids(elide(rows, 's', before)), [
    'l1',
    'l4',
    'l7',
    'l8',
    'l9',
    'l10',
    'l11',
    'l12',
    'l13',
    'l14',
  ])
  equal(rows, original)
  rows.push(line(15, { ask: { elided_before: before } }))
  equal(elidedBefore(rows, 's'), before)
})

test('current turn notes admitted before the input survive a cold continuation', () => {
  let rows = [
    line(1, { prompt: { scope: 'turn' }, content: { body: 'earlier Read' } }),
    line(2, { content: { body: 'earlier input' } }),
    line(3, { prompt: { scope: 'turn' }, content: { body: 'current Read' } }),
    line(4, { content: { body: 'current input' } }),
    line(5, { ask: {} }),
    line(6, { output: { source: 'l5' }, content: { body: 'partial reply' } }),
  ]
  equal(ids(elide(rows, 's', nextElision(rows, 's'))), [
    'l2',
    'l3',
    'l4',
    'l5',
    'l6',
  ])
})

test('cold elision waits one minute beyond the expiry the provider recorded', () => {
  let expiry = '2026-11-20T12:00:00.000Z'
  let rows = [line(1, { ask: {}, fake: { cache_expires_at: expiry } })]
  let at = Date.parse(expiry) + 60_000
  equal(pastCache(rows, 's', at - 1), false)
  equal(pastCache(rows, 's', at), true)
  equal(pastCache(rows, 'other', at), false)
  equal(pastCache([line(1, { ask: {} })], 's', at), false)
})

// What the fake provider keeps about an ask: its reply, and when the prefix
// that request cached expires.
let fakeDoc: VocabDoc = {
  $defs: {
    fake: {
      component: true,
      type: 'object',
      properties: {
        reply: { type: 'string' },
        cache_expires_at: { type: 'string' },
      },
    },
  },
}
let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  { $defs: { provisional: effectDoc.$defs!.provisional } },
  sessionDoc,
  toolsDoc,
  modelDoc,
  fakeDoc,
  contextDoc,
  taskDoc,
  edgeDoc,
  docDoc,
], [kernelKeywords, edgeKeywords])
let m = identityEid('model', ['fake-1'])
let echo = {
  name: 'echo',
  description: 'say it back',
  parameters: { type: 'object', properties: { text: { type: 'string' } } },
  // Long enough to fill a small window.
  run: (args: Record<string, unknown>) =>
    `echo: ${String(args.text)}` + ' and on'.repeat(200),
}
let COLD = '2026-01-01T00:00:00.000Z', WARM = '2999-01-01T00:00:00.000Z'
// What the first turn leaves to drop: the worker's report, the call and its
// result.
let GONE: Kind[] = ['input', 'call', 'result']

// A session whose first turn called a tool and replied, on a provider whose
// cache expires at `expires`; then a second input, and what that turn sent.
// `wears` is what the session and its persona carry.
let second = async (
  expires: string | undefined,
  wears: { session?: object; persona?: object } = { session: { drops: {} } },
  deps: object = {},
  context?: number,
  warmAgain = false,
) => {
  let g = graph({
    storage: ram(vocab, {
      computed: { ...attemptComputed, ...executionComputed },
    }),
    vocab,
    plugins: [sessions()],
  })
  seedIdentities(g, 'runner', 'here')
  await g.apply([
    { entity: { eid: m }, model: { name: 'fake-1' } },
    { entity: { eid: toolEid('echo') }, tool: { name: 'echo' } },
    { entity: { eid: 'persona' }, ...wears.persona },
    { entity: { eid: 's' }, session: { persona: 'persona' }, ...wears.session },
    // What the bus said before the turn: a worker's report, and a person's
    // comment.
    {
      entity: { eid: 'report' },
      entry: { session: 's' },
      attention: { worker: 'other' },
      content: { body: 'knock from a worker: all green' },
    },
    {
      entity: { eid: 'words' },
      entry: { session: 's' },
      attention: {},
      content: { body: 'comment from Jeff: keep it short' },
    },
    {
      entity: { eid: 'first' },
      entry: { session: 's' },
      content: { body: 'echo hi, then say done' },
      using: { model: m },
    },
    // Another session's call and result, which are not this one's to drop.
    { entity: { eid: 'other' }, session: {} },
    { entity: { eid: 'theirs' }, entry: { session: 'other' }, call: {} },
    {
      entity: { eid: 'answer' },
      entry: { session: 'other' },
      result: { call: 'theirs' },
    },
  ])
  let replies: Reply[] = [
    {
      id: 'r1',
      model: 'fake-1',
      items: [{ kind: 'call', id: 'c1', name: 'echo', args: '{"text":"hi"}' }],
    },
    ...['done', 'done again', 'and again'].map((text, i): Reply => ({
      id: 'r' + (i + 2),
      model: 'fake-1',
      items: [{ kind: 'assistant', text }],
    })),
  ]
  let asked: Request[] = []
  let model: Model = (req) => {
    asked.push(req)
    return Promise.resolve(replies.shift()!)
  }
  model.mark = (reply) => {
    let at = warmAgain && reply.id == 'r3' ? WARM : expires
    return {
      fake: { reply: reply.id, ...at ? { cache_expires_at: at } : {} },
    }
  }
  let run = () =>
    settle(g, 's', { holder: 'runner', model, tools: [echo], ...deps })
  await run()
  if (context) await g.apply([{ entity: { eid: m }, model: { context } }])
  await g.apply([{
    entity: { eid: 'again' },
    entry: { session: 's' },
    content: { body: 'and once more' },
  }])
  await run()
  if (warmAgain) {
    await g.apply([{
      entity: { eid: 'warm' },
      entry: { session: 's' },
      content: { body: 'a warm follow-up' },
    }])
    await run()
  }
  let entries = await transcript(g, 's')
  let others = await g.get(['theirs', 'answer'], ['archived'])
  return {
    others: others.filter((b) => b.archived).length,
    sent: JSON.stringify(asked.at(-1)!.items),
    asks: asked.length,
    entries,
    dropped: entries.filter((b) => b.archived).map(kindOf),
  }
}

test('a request that starts after the cache has gone cold leaves out the earlier call and its result, and asks no model for it', async () => {
  let { sent, asks, dropped, entries, others } = await second(COLD)
  equal(dropped, GONE)
  equal(others, 0)
  equal(sent.includes('echo: hi') || sent.includes('all green'), false)
  equal(
    ['keep it short', 'echo hi, then say done', 'done', 'and once more']
      .every((words) => sent.includes(words)),
    true,
  )
  equal(asks, 3)
  // The row keeps its words for whoever reads it by id.
  let result = entries.find((b) => b.result)!
  equal(
    String((result.content as { body: string }).body).includes('echo: hi'),
    true,
  )
})

test('the cold prompt projection survives warm requests and leaves the original rows readable', async () => {
  let { sent, asks, dropped, entries } = await second(
    COLD,
    {},
    { elideCold: true },
    undefined,
    true,
  )
  equal(asks, 4)
  equal(dropped, [])
  equal(sent.includes('echo: hi') || sent.includes('all green'), false)
  equal(
    [
      'keep it short',
      'echo hi, then say done',
      'done',
      'and once more',
      'a warm follow-up',
    ]
      .every((words) => sent.includes(words)),
    true,
  )
  equal(
    entries.some((b) =>
      b.result &&
      String((b.content as { body: string }).body).includes('echo: hi')
    ),
    true,
  )
})

test('a cold request elides without calling the summarizer even when a checkpoint is due', async () => {
  let summaries = 0
  let summarizer: Model = () => {
    summaries++
    return Promise.resolve({
      id: 'summary',
      model: 'fake-1',
      items: [{ kind: 'assistant', text: 'summary' }],
    })
  }
  let { sent } = await second(COLD, {}, {
    elideCold: true,
    compactModel: { model: summarizer, name: 'fake-1' },
  }, 600)
  equal(summaries, 0)
  equal(sent.includes('echo: hi'), false)
  equal(sent.includes('echo hi, then say done'), true)
})

test('while the cache is warm, or a provider says nothing of it, the result stays', async () => {
  equal((await second(WARM)).dropped, [])
  equal((await second(undefined)).dropped, [])
})

test('a session drops only where it or the persona it wears says so', async () => {
  equal((await second(COLD, {})).dropped, [])
  equal(
    (await second(COLD, { persona: { drops: {} } })).dropped,
    GONE,
  )
})

test('where a summary is due while the cache is warm, a session that drops does that first and writes no summary', async () => {
  let due = async (wears?: object) => {
    let summaries = 0
    let summarizer: Model = () => {
      summaries++
      return Promise.resolve({
        id: 'summary',
        model: 'fake-1',
        items: [{ kind: 'assistant', text: 'It echoed hi.' }],
      })
    }
    let run = await second(WARM, wears, {
      compactModel: { model: summarizer, name: 'fake-1' },
    }, 600)
    return { dropped: run.dropped, summaries, sent: run.sent }
  }
  equal((await due({})).summaries, 1)
  let { dropped, summaries, sent } = await due()
  equal([dropped, summaries], [GONE, 0])
  equal(sent.includes('and once more'), true)
})
