import { equal, test, throws } from '@yaks/testing'
import { identityEid } from '@yaks/graph'
import { effectDoc, held } from '@yaks/effects'
import { kernelDoc } from '@yaks/kernel/vocab'
import {
  type Model,
  modelDoc,
  ModelError,
  type Reply,
  type Request,
} from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { toolEid } from '@yaks/tools'
import { loadVocab, pick } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'
import { contextDoc } from '@yaks/context'
import { transcriptGraph } from './testing.ts'
import { react, transcript } from './react.ts'
import { RUN, type Runner, settle } from './run.ts'

let vocab = loadVocab([
  pick(sessionDoc, [
    'session',
    'input_context',
    'entry',
    'ask',
    'using',
    'sending',
    'attempt',
    'notice',
    'stop',
    'session_run',
  ]),
  toolsDoc,
  modelDoc,
  pick(contextDoc, ['prompt']),
  pick(effectDoc, ['lease']),
  pick(kernelDoc, ['interrupted', 'failed']),
])
let M = identityEid('model', ['hosted'])
let P = identityEid('provider', ['hosted'])
let fixture = () => {
  let g = transcriptGraph(vocab)
  g.apply([
    { entity: { eid: 'session' }, session: { id: 'hosted' } },
    { entity: { eid: 'worker' } },
    { entity: { eid: M }, model: { name: 'hosted' } },
    { entity: { eid: P }, provider: { name: 'hosted' } },
    {
      entity: { eid: 'input' },
      entry: { session: 'session' },
      content: { body: 'hello' },
      using: { provider: P, model: M },
    },
  ], { trusted: true })
  let inline = 0
  let model: Model = () => {
    inline++
    return Promise.resolve({ id: 'inline', model: 'hosted', items: [] })
  }
  let submitted: Request[] = [], resumed: string[] = []
  let reply: Reply | undefined
  let serial = 0
  let r: Runner = {
    mint: () => `entry-${++serial}`,
    holder: 'worker',
    model,
    tools: [],
    executor: {
      submit: async (call, request) => {
        submitted.push(request)
        await g.apply([{
          entity: { eid: call },
          inference: { executor: 'hosted', request: 'private-request' },
        }], { trusted: true })
      },
      resume: (call) => {
        resumed.push(call)
        return Promise.resolve(reply)
      },
    },
  }
  return {
    g,
    r,
    submitted,
    resumed,
    inline: () => inline,
    reply: (value: Reply) => reply = value,
  }
}

let pending = (p: ReturnType<typeof fixture>, frozen = true) =>
  p.g.apply([{
    entity: { eid: 'ask' },
    entry: { session: 'session' },
    ask: { to: M, through: 'input' },
    using: { provider: P, model: M },
    attempt: { by: 'worker' },
    ...frozen
      ? { inference: { executor: 'hosted', request: 'private-request' } }
      : {},
  }], { trusted: true })

let saved: Reply = {
  id: 'saved',
  model: 'hosted',
  items: [{ kind: 'assistant', text: 'hello back' }],
  cost: 0.02,
}

// These integration cases check captured outcomes. Each owns its graph and
// runs its fixture before timing; all comparisons still run in the named case.
let scenario = async (
  name: string,
  body: (p: ReturnType<typeof fixture>, check: typeof equal) => Promise<void>,
) => {
  let p = fixture()
  let checks: (() => void)[] = []
  await body(p, (actual, expected, message) => {
    // Snapshot now: later steps may mutate the submitted/resumed arrays.
    let values = structuredClone([actual, expected])
    checks.push(() => equal(values[0], values[1], message))
    return actual
  })
  test(name, () => {
    for (let check of checks) check()
  })
}

await scenario(
  'hosted submission commits an ask and yields while pending',
  async (p, equal) => {
    equal((await react(p.g, 'session', p.r)).did, 'nothing')
    equal(p.inline(), 0)
    equal(p.submitted.length, 1)
    let call = p.submitted[0].call!
    equal(p.submitted[0].conversation, 'session')
    let [ask] = await p.g.get([call])
    equal((ask.sending as Record<string, unknown>).tools, [])
    equal(ask.ask != null, true)
  },
)

await scenario(
  'new asks use the inline provider until the hosted executor is live',
  async (p, equal) => {
    p.r.executor!.available = () => false
    equal((await react(p.g, 'session', p.r)).status, 'settled')
    equal(p.inline(), 1)
    equal(p.submitted, [])
    let asks = (await transcript(p.g, 'session')).filter((b) => b.ask)
    equal(asks.length, 1)
    equal(asks[0].inference, undefined)
    equal(asks[0].attempt, {})
  },
)

await scenario(
  'accepted asks resume their receipt while the hosted executor is unavailable',
  async (p, equal) => {
    pending(p)
    p.r.executor!.available = () => false
    p.reply(saved)
    equal((await react(p.g, 'session', p.r)).status, 'settled')
    equal(p.resumed, ['ask'])
    equal(p.inline(), 0)
    equal(p.submitted, [])
    equal((await p.g.get(['ask']))[0].cost, { dollars: 0.02, reported: true })
  },
)

await scenario(
  'a final dispatch refusal settles the original ask without pending work',
  async (p, equal) => {
    let calls: string[] = []
    p.r.executor!.submit = (call) => {
      calls.push(call)
      return Promise.reject(
        new ModelError('limit', 'The account budget is spent'),
      )
    }
    equal((await react(p.g, 'session', p.r)).status, 'failed')
    await react(p.g, 'session', p.r)
    let entries = await transcript(p.g, 'session')
    let asks = entries.filter((b) => b.ask)
    equal(asks.map((b) => b.entity.eid), calls)
    equal(asks[0].attempt, {})
    equal(asks[0].inference, undefined)
    equal(entries.find((b) => b.refusal)?.refusal, { code: 'limit' })
    equal(p.inline(), 0)
  },
)

await scenario(
  'a transient dispatch failure retries the same ask without inline generation',
  async (p, equal) => {
    let submit = p.r.executor!.submit
    let calls: string[] = []
    let failure = new Error('Executor unavailable')
    p.r.executor!.submit = (call, request) => {
      calls.push(call)
      return calls.length == 1 ? Promise.reject(failure) : submit(call, request)
    }
    await throws(() => react(p.g, 'session', p.r), /Executor unavailable/)
    let [ask] = await p.g.get([calls[0]])
    equal((ask.attempt as Record<string, unknown>).by != null, true)
    equal(ask.failed, undefined)
    equal(ask.inference, undefined)
    await react(p.g, 'session', p.r)
    equal(calls, [ask.entity.eid, ask.entity.eid])
    equal(p.submitted.map((request) => request.call), [ask.entity.eid])
    equal((await transcript(p.g, 'session')).filter((b) => b.ask).length, 1)
    equal(p.inline(), 0)
  },
)

await scenario(
  'a pending hosted ask survives a restarted runner without another submission',
  async (p, equal) => {
    pending(p)
    await settle(p.g, 'session', p.r)
    equal(p.resumed, ['ask'])
    equal((await held(p.g, `${RUN}/session`))?.holder ?? null, null)
    equal(p.submitted.length, 0)
    equal((await p.g.get(['ask']))[0].interrupted, undefined)
  },
)

await scenario(
  'a hosted receipt delivers and costs its original ask once',
  async (p, equal) => {
    pending(p)
    p.reply(saved)
    await react(p.g, 'session', p.r)
    await react(p.g, 'session', p.r)
    let entries = await transcript(p.g, 'session')
    equal(entries.filter((b) => b.ask).map((b) => b.entity.eid), ['ask'])
    equal(entries.filter((b) => b.output).map((b) => b.content), [
      { body: 'hello back' },
    ])
    equal((await p.g.get(['ask']))[0].cost, { dollars: 0.02, reported: true })
    equal(p.inline(), 0)
    equal(p.submitted.length, 0)
  },
)

await scenario(
  'an ask lost before dispatch freezes its original context on the same id',
  async (p, equal) => {
    pending(p, false)
    await p.g.apply([{
      entity: { eid: 'later' },
      entry: { session: 'session' },
      content: { body: 'another message' },
    }])
    await react(p.g, 'session', p.r)
    equal(p.submitted.map((req) => req.call), ['ask'])
    equal(p.submitted[0].items, [{ kind: 'user', text: 'hello' }])
    equal(p.inline(), 0)
  },
)

await scenario(
  'a terminal hosted outcome never becomes an automatic new ask',
  async (p, equal) => {
    pending(p)
    p.r.executor!.resume = () =>
      Promise.reject(new ModelError('inference_interrupted'))
    equal((await react(p.g, 'session', p.r)).status, 'failed')
    equal((await p.g.get(['ask']))[0].interrupted, {
      code: 'inference_interrupted',
    })
    equal(p.submitted.length, 0)
    equal(p.inline(), 0)
  },
)

await scenario(
  'an unavailable hosted executor leaves accepted work pending',
  async (p, equal) => {
    pending(p)
    delete p.r.executor
    equal((await react(p.g, 'session', p.r)).did, 'nothing')
    equal((await p.g.get(['ask']))[0].interrupted, undefined)
    equal(p.inline(), 0)
  },
)

await scenario(
  'a receipt read failure keeps its original ask available to retry',
  async (p, equal) => {
    pending(p)
    let failure = new Error('Receipt store unavailable')
    p.r.executor!.resume = () => Promise.reject(failure)
    let caught: unknown
    try {
      await react(p.g, 'session', p.r)
    } catch (error) {
      caught = error
    }
    equal(caught, failure)
    equal((await p.g.get(['ask']))[0].attempt, { by: 'worker' })
    equal((await p.g.get(['ask']))[0].interrupted, undefined)
  },
)

// The accepted ask and executor callback are history; only the receipt race
// and the lease handoff are timed.
let arriving = fixture()
pending(arriving)
let receiptChecks = 0
arriving.r.executor!.resume = async () => {
  if (++receiptChecks > 1) return { ...saved, items: [] }
  await arriving.g.apply([{
    entity: { eid: 'ask' },
    inference: { receipt: 'private-receipt' },
  }])
  return undefined
}
await settle(arriving.g, 'session', arriving.r)
let [arrivedAsk] = await arriving.g.get(['ask'])
test('a receipt arriving during a pending step is delivered after lease release', () => {
  equal(receiptChecks, 2)
  equal(arrivedAsk.cost, { dollars: 0.02, reported: true })
  equal(arrivedAsk.attempt, {})
})

await scenario(
  'hosted tool replies retain their stable identity across a later selection',
  async (p, equal) => {
    pending(p)
    let called = 0
    let old = {
      name: 'old',
      description: 'previous offer',
      parameters: {},
      run: () => {
        called++
        return 'done'
      },
    }
    p.r.named = () => [old]
    await p.g.apply([
      { entity: { eid: toolEid('old') }, tool: { name: 'old' } },
      { entity: { eid: 'ask' }, sending: { tools: ['old'] } },
      {
        entity: { eid: 'later' },
        entry: { session: 'session' },
        content: { body: 'the following turn uses different tools' },
        using: { provider: P, model: M },
        sending: { tools: [] },
      },
    ])
    p.reply({
      id: 'tool-reply',
      model: 'hosted',
      items: [{ kind: 'call', id: 'old-call', name: 'old', args: '{}' }],
    })
    await react(p.g, 'session', p.r)
    let call = (await transcript(p.g, 'session')).find((b) => b.call)!
    equal((call.call as Record<string, unknown>).to, toolEid('old'))
    equal(called, 0)
  },
)

await scenario(
  'tool execution uses its source ask offer after a later selection',
  async (p, equal) => {
    let called = 0
    let old = {
      name: 'old',
      description: 'previous offer',
      parameters: {},
      run: () => {
        called++
        return 'done'
      },
    }
    p.r.named = () => [old]
    await p.g.apply([
      { entity: { eid: toolEid('old') }, tool: { name: 'old' } },
      {
        entity: { eid: 'ask' },
        entry: { session: 'session' },
        ask: { to: M, through: 'input' },
        using: { provider: P, model: M },
        sending: { tools: ['old'] },
        attempt: { by: null },
      },
      {
        entity: { eid: 'tool-call' },
        entry: { session: 'session' },
        call: { to: toolEid('old'), id: 'old-call', source: 'ask', args: {} },
      },
      {
        entity: { eid: 'later' },
        entry: { session: 'session' },
        content: { body: 'the following turn uses different tools' },
        using: { provider: P, model: M },
        sending: { tools: [] },
      },
    ])
    await react(p.g, 'session', p.r)
    equal(called, 1)
  },
)

await scenario(
  'enabling hosted execution leaves older inline asks interrupted',
  async (p, equal) => {
    pending(p, false)
    p.r.executor!.name = 'hosted'
    await react(p.g, 'session', p.r)
    equal((await p.g.get(['ask']))[0].interrupted, { code: 'restart' })
    equal(p.submitted.length, 0)
    equal(p.inline(), 0)
  },
)

await scenario(
  'a hosted receipt keeps a first-use tool target before registration',
  async (p, equal) => {
    pending(p)
    p.reply({
      id: 'first-tool',
      model: 'hosted',
      items: [{ kind: 'call', id: 'first', name: 'fresh', args: '{}' }],
    })
    await react(p.g, 'session', p.r)
    let entries = await transcript(p.g, 'session')
    let call = entries.find((b) => b.call)!
    equal((call.call as Record<string, unknown>).to, toolEid('fresh'))
    equal(p.inline(), 0)
  },
)

for (let hosted of [false, true]) {
  await scenario(
    `${
      hosted ? 'hosted' : 'inline'
    } requests keep explicit context without stored recall`,
    async (p, equal) => {
      let recalled = {
        items: [{ kind: 'user', text: 'private historical words' }],
      }
      await p.g.apply([{
        entity: { eid: 'input' },
        input_context: recalled,
      }, {
        entity: { eid: 'instructions' },
        entry: { session: 'session' },
        prompt: {},
        content: { body: 'Deliberately admitted topic context' },
      }], { trusted: true })
      let requests: Request[] = []
      p.r.model = (req) => {
        requests.push(req)
        return Promise.resolve({ id: 'fake', model: req.model, items: [] })
      }
      if (!hosted) delete p.r.executor
      p.r.requestItems = () =>
        Promise.resolve([{ kind: 'instruction', text: 'Available skills' }])
      p.r.contextItems = () =>
        Promise.resolve(
          new Map([
            ['input', [{
              kind: 'user',
              text: 'Explicit source-bound context',
            }]],
          ]),
        )
      await react(p.g, 'session', p.r)
      let req = (hosted ? p.submitted : requests)[0]
      equal(req.items, [
        { kind: 'instruction', text: 'Available skills' },
        { kind: 'user', text: 'hello' },
        { kind: 'user', text: 'Explicit source-bound context' },
        { kind: 'instruction', text: 'Deliberately admitted topic context' },
      ])
      equal((await p.g.get(['input']))[0].input_context, recalled)
    },
  )
}
