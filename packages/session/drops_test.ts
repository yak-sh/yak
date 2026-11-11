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
import { answered, replied } from './pruning.ts'
import { kindOf } from './state.ts'

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

// A session whose first turn called a tool and replied, on a provider whose
// cache expires at `expires`; then a second input, and what that turn sent.
// `wears` is what the session and its persona carry.
let second = async (
  expires: string | undefined,
  wears: { session?: object; persona?: object } = { session: { drops: {} } },
  deps: object = {},
  context?: number,
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
    {
      entity: { eid: 'first' },
      entry: { session: 's' },
      content: { body: 'echo hi, then say done' },
      using: { model: m },
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
  model.mark = (reply) => ({
    fake: { reply: reply.id, ...expires ? { cache_expires_at: expires } : {} },
  })
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
  let entries = await transcript(g, 's')
  return {
    sent: JSON.stringify(asked.at(-1)!.items),
    asks: asked.length,
    entries,
    dropped: entries.filter((b) => b.archived).map(kindOf),
  }
}

test('a request that starts after the cache has gone cold leaves out the earlier call and its result, and asks no model for it', async () => {
  let { sent, asks, dropped, entries } = await second(COLD)
  equal(dropped, ['call', 'result'])
  equal(sent.includes('echo: hi'), false)
  equal(
    ['echo hi, then say done', 'done', 'and once more']
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

test('while the cache is warm, or a provider says nothing of it, the result stays', async () => {
  equal((await second(WARM)).dropped, [])
  equal((await second(undefined)).dropped, [])
})

test('a session drops only where it or the persona it wears says so', async () => {
  equal((await second(COLD, {})).dropped, [])
  equal(
    (await second(COLD, { persona: { drops: {} } })).dropped,
    ['call', 'result'],
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
  equal([dropped, summaries], [['call', 'result'], 0])
  equal(sent.includes('and once more'), true)
})
