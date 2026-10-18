// Hosted steps return independently; pending tool work is not another ask.
import { equal, test } from '@yaks/testing'
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
import { statusComputed } from './state.ts'
import { attemptComputed } from './attempt.ts'

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
await g.apply([
  { entity: { eid: 's' }, session: { id: 's' } },
  { entity: { eid: 'worker' }, session: { id: 'worker' } },
  { entity: { eid: M }, model: { name: 'fake' } },
  { entity: { eid: P }, provider: { name: 'fake' } },
  { entity: { eid: toolEid('read') }, tool: { name: 'read' } },
  {
    entity: { eid: 'input' },
    entry: { session: 's' },
    content: { body: 'read both' },
    using: { model: M, provider: P },
  },
])
let asks: Request[] = [], started: number[] = []
let release!: () => void
let gate = new Promise<void>((go) => release = go)
let both!: () => void
let began = new Promise<void>((go) => both = go)
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
    items: asks.length == 1
      ? [1, 2].map((n) => ({
        kind: 'call' as const,
        id: `call${n}`,
        name: 'read',
        args: JSON.stringify({ n }),
      }))
      : [{ kind: 'assistant' as const, text: 'done' }],
  }
}
let handlers = running(g, {
  holder: 'worker',
  model,
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
let run = (handler: string, target: string, name = 'session') =>
  handlers[handler](
    { kind: 'matched', entity: { eid: target }, name },
    g.outside,
    (rows) => g.apply(rows),
  )
await run('session_run', 'input', 'using')
let entries = async () => await g.read('.entry.session=s .order=entry.seq *')
let calls = (await entries()).filter((b) => b.call)
let initial = { asks: asks.length, started: [...started] }

test('one hosted model step returns before its tool calls execute', () => {
  equal(initial.asks, 1)
  equal(initial.started, [])
  equal(calls.length, 2)
})

let tools = calls.map((call) => run('session_tool', call.entity.eid))
await began
await run('session_run', 's')
let pendingAsks = asks.length
release()
await Promise.all(tools)
let finals = (await entries()).filter((b) => b.result)
await run('session_run', finals[0].entity.eid, 'result')
let next = asks[1], finishedAsks = asks.length
let [boundary] = await g.rows(
  '.entry.session=s .ask .order=-entry.seq .limit=1 .fields=ask.through',
)

test('independent calls finish together and the next ask includes their finals', () => {
  equal(started, [1, 2])
  equal(pendingAsks, 1)
  equal(finishedAsks, 2)
  equal(finals.length, 2)
  for (let n of [1, 2]) {
    equal(
      next.items.some((item) =>
        item.kind == 'result' && item.output.includes(`FINAL_${n}`)
      ),
      true,
    )
  }
  equal(boundary['ask.through'], finals.at(-1)!.entity.eid)
  equal(next.items.filter((item) => item.kind == 'result').length, 2)
})

await g.apply([{
  entity: { eid: 'later' },
  entry: { session: 's' },
  content: { body: 'continue' },
}])
steer = true
await run('session_run', 'later', 'using')
let firstStepAsks = asks.length
await run('session_run', 'steering', 'using')
let secondStepAsks = asks.length

test('input arriving during a model step is consumed by its own owed step', () => {
  equal(firstStepAsks, 3)
  equal(secondStepAsks, 4)
})
