// Hosted steps return independently; a model turn starts while tools run only
// for something new: a result, an input, or the Pending of a call that
// outlasted its patience.
import { equal, test, until } from '@yaks/testing'
import { graph, identityEid } from '@yaks/graph'
import { effectDoc } from '@yaks/effects'
import { kernelDoc } from '@yaks/kernel/vocab'
import { type Model, modelDoc, type Request } from '@yaks/model'
import { executionComputed, toolEid, toolsDoc } from '@yaks/tools'
import { loadVocab, pick } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'
import { running } from './run.ts'
import { ram } from '@yaks/ram'
import { sessions } from './plugin.ts'
import { kindOf, statusComputed } from './state.ts'
import { attemptComputed } from './attempt.ts'
import { PENDING } from './project.ts'

let vocab = loadVocab([
  sessionDoc,
  toolsDoc,
  modelDoc,
  effectDoc,
  pick(kernelDoc, ['interrupted', 'failed']),
])
let M = identityEid('model', ['fake'])
let P = identityEid('provider', ['fake'])
let g = graph({
  storage: ram(vocab, {
    computed: {
      ...statusComputed,
      ...attemptComputed,
      ...executionComputed,
    },
  }),
  vocab,
  plugins: [sessions()],
})
// Two transcripts: `s` runs with the default patience, `q` with none.
await g.apply([
  { entity: { eid: 's' }, session: { id: 's' } },
  { entity: { eid: 'q' }, session: { id: 'q' } },
  { entity: { eid: 'worker' }, session: { id: 'worker' } },
  { entity: { eid: M }, model: { name: 'fake' } },
  { entity: { eid: P }, provider: { name: 'fake' } },
  { entity: { eid: toolEid('read') }, tool: { name: 'read' } },
  ...['s', 'q'].map((session) => ({
    entity: { eid: `input-${session}` },
    entry: { session },
    content: { body: 'read both' },
    using: { model: M, provider: P },
  })),
])
// The model calls `read` twice when it has called nothing yet, then is done.
let asks: Request[] = [], started: number[] = []
let release!: () => void
let gate = Promise.resolve()
let both!: () => void
let began = Promise.resolve()
let hold = () => {
  gate = new Promise<void>((go) => release = go)
  began = new Promise<void>((go) => both = go)
  started = []
}
let steer = false
let model: Model = async (request) => {
  asks.push(request)
  if (steer) {
    steer = false
    await g.apply([{
      entity: { eid: 'steering' },
      entry: { session: 's' },
      content: { body: 'one more thing' },
    }])
  }
  return {
    id: String(asks.length),
    model: request.model,
    items: request.items.some((item) => item.kind == 'call')
      ? [{ kind: 'assistant' as const, text: 'done' }]
      : [1, 2].map((n) => ({
        kind: 'call' as const,
        id: `call${n}`,
        name: 'read',
        args: JSON.stringify({ n }),
      })),
  }
}
let handlers = (patience?: number) =>
  running(g, {
    holder: 'worker',
    model,
    ...patience == null ? {} : { patience },
    tools: [{
      name: 'read',
      description: '',
      parameters: {},
      run: async (args) => {
        started.push(Number(args.n))
        if (started.length == 2) both()
        await gate
        return `FINAL_${args.n}`
      },
    }],
  })
let entries = async (session: string) =>
  await g.read(`.entry.session=${session} .order=entry.seq *`)
// A transcript asked once, its two calls run to their finals, and every
// model turn taken while they ran.
let turn = async (session: string, patience?: number) => {
  let h = handlers(patience)
  let run = (handler: string, target: string, name = 'session') =>
    h[handler](
      { kind: 'matched', entity: { eid: target }, name },
      g.outside,
      (rows) => g.apply(rows),
    )
  hold()
  let from = asks.length
  await run('session_run', `input-${session}`, 'using')
  let calls = (await entries(session)).filter((b) => b.call)
  let asked = asks.length - from
  let tools = calls.map((call) => run('session_tool', call.entity.eid))
  await began
  if (patience == 0) {
    await until(async () =>
      (await entries(session)).filter((b) => b.tool_progress).length == 2
    )
  }
  await run('session_run', session)
  let running = asks.length - from
  release()
  await Promise.all(tools)
  let finals = (await entries(session)).filter((b) => b.result)
  await run('session_run', finals[0].entity.eid, 'result')
  return {
    asked,
    calls: calls.length,
    running,
    finished: asks.length - from,
    kinds: (await entries(session)).map(kindOf),
    next: asks.at(-1)!,
    run,
  }
}
// What answers the calls in a request, line by line, without their timing.
let answers = (request: Request) =>
  request.items.flatMap((item) =>
    item.kind == 'result'
      ? [item.output]
      : item.kind == 'user' && item.text.includes('FINAL_')
      ? [item.text]
      : []
  ).map((text) => text.split('\n').filter((line) => !line.startsWith('took ')))

let s = await turn('s')
let q = await turn('q', 0)

test('one hosted model step returns before its tool calls execute', () => {
  equal([s.asked, s.calls], [1, 2])
})

test('calls that answer within their patience start no turn while they run', () => {
  equal([s.running, s.finished], [1, 2])
  equal(s.kinds, [
    'input',
    'ask',
    'call',
    'call',
    'result',
    'result',
    'ask',
    'output',
  ])
  equal(answers(s.next), [['FINAL_1'], ['FINAL_2']])
})

test('calls that outlast their patience get a Pending, and the model goes on', () => {
  equal([q.running, q.finished], [2, 3])
  equal(q.kinds.filter((k) => k == 'result').length, 4)
  equal(answers(q.next), [
    [PENDING],
    [PENDING],
    ['The pending read call call1 {"n":1} finished:', 'FINAL_1'],
    ['The pending read call call2 {"n":2} finished:', 'FINAL_2'],
  ])
})

await g.apply([{
  entity: { eid: 'later' },
  entry: { session: 's' },
  content: { body: 'continue' },
}])
steer = true
let before = asks.length
await s.run('session_run', 'later', 'using')
let firstStep = asks.length - before
await s.run('session_run', 'steering', 'using')
let secondStep = asks.length - before

test('input arriving during a model step is consumed by its own owed step', () => {
  equal([firstStep, secondStep], [1, 2])
})
