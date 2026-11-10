// A model step crosses hosts: the calling host's graph says a machine serves
// a provider, and the serving host answers from the providers its own graph
// says serve the model. Both ends run here, in one process, over two graphs.

import { assertEquals, assertRejects } from '@std/assert'
import { edgeDoc, edgeEid, edgeKeywords } from '@yaks/edge'
import { graph, identityEid } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { clock, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import {
  type Model,
  modelDoc,
  ModelError,
  type Reply,
  type Request as Step,
  serving,
  type TextDelta,
} from './mod.ts'
import { answering, BEAT, forwarded, forwarding, PATH } from './step.ts'

let machineDoc = {
  $defs: {
    machine: {
      component: true,
      type: 'object',
      properties: { address: { type: 'string' } },
    },
  },
}
let vocab = loadVocab(
  [kernelDoc, edgeDoc, modelDoc, machineDoc],
  [kernelKeywords, edgeKeywords],
)
let BOX = 'b0000000-0000-4000-8000-000000000001'
let OFF = 'b0000000-0000-4000-8000-000000000002'

// The serving host: `stub` serves the model `sonnet`, which it calls `s-5`.
let box = async (
  stub: Model,
  report: (error: unknown) => void = (error) => {
    throw error
  },
  time?: ReturnType<typeof clock>,
) => {
  let g = graph({ storage: ram(vocab), vocab })
  let provider = identityEid('provider', ['stub'])
  let model = identityEid('model', ['sonnet'])
  await g.apply([
    { entity: { eid: provider }, provider: { name: 'stub' } },
    { entity: { eid: model }, model: { name: 'sonnet' } },
    {
      entity: { eid: edgeEid(provider, 'serves', model) },
      edge: { from: provider, to: model },
      serves: { name: 's-5' },
    },
  ])
  return answering(serving(g, { stub }), report, time)
}

// The calling host: its rows say the machine BOX serves `box`, a machine
// nothing reaches serves `off`, and no machine serves `nowhere`.
let caller = async (
  answer: (request: Request) => Promise<Response>,
  seen: Request[] = [],
) => {
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply([
    { entity: { eid: BOX }, machine: { address: 'ssh://box' } },
    { entity: { eid: OFF }, machine: {} },
    {
      entity: { eid: '$box' },
      provider: { name: 'box', transport: 'machine', machine: BOX },
    },
    {
      entity: { eid: '$off' },
      provider: { name: 'off', transport: 'machine', machine: OFF },
    },
    {
      entity: { eid: '$nowhere' },
      provider: { name: 'nowhere', transport: 'machine' },
    },
    { entity: { eid: '$api' }, provider: { name: 'api', transport: 'http' } },
  ])
  return await forwarded(g, (machine) =>
    machine == BOX
      ? (at, init) => {
        let request = new Request(at, init)
        seen.push(request)
        return answer(request)
      }
      : undefined)
}

let hello: Reply = {
  id: 'r1',
  model: 's-5',
  items: [{ kind: 'assistant', text: 'Hello there' }, {
    kind: 'call',
    id: 'c1',
    name: 'double',
    args: '{"n":2}',
  }],
  usage: { input_tokens: 12, output_tokens: 3 },
  cost: 0.25,
  costReported: true,
}
let ask = (more: Partial<Step> = {}): Step => ({
  model: 'sonnet',
  items: [{ kind: 'user', text: 'Hi' }],
  tools: [],
  ...more,
})

test("a step is forwarded to the machine its provider row names and answered by that host's provider", async () => {
  let got: Step[] = []
  let seen: Request[] = []
  let stub: Model = (req) => {
    got.push(req)
    req.onFirst?.()
    req.onText?.({ index: 0, text: 'Hello ' })
    req.onText?.({ index: 0, text: 'there' })
    return Promise.resolve(hello)
  }
  let served = await caller(await box(stub), seen)
  assertEquals(Object.keys(served), ['box'])

  let deltas: TextDelta[] = [], firsts = 0, submits = 0
  let tool = { name: 'double', description: 'Double it', parameters: {} }
  let reply = await served.box(ask({
    instructions: 'Be brief',
    effort: 'low',
    tokens: 100,
    stallTimeout: 30,
    cacheRetention: 3600,
    tools: [tool],
    items: [{ kind: 'user', text: 'Hi' }, {
      kind: 'image',
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
      label: 'dot',
    }],
    onText: (delta) => deltas.push(delta),
    onFirst: () => firsts++,
    onSubmit: () => Promise.resolve(void submits++),
  }))

  let { cost: _cost, costReported: _reported, ...kept } = hello
  assertEquals(reply, kept)
  assertEquals(deltas.map((d) => d.text).join(''), 'Hello there')
  assertEquals([firsts, submits], [1, 1])
  assertEquals(
    [seen[0].method, new URL(seen[0].url).pathname],
    ['POST', PATH],
  )
  let { signal, onText: _text, onFirst: _first, ...asked } = got[0]
  assertEquals(signal?.aborted, false)
  assertEquals(asked, {
    model: 's-5',
    instructions: 'Be brief',
    effort: 'low',
    tokens: 100,
    stallTimeout: 30,
    cacheRetention: 3600,
    tools: [tool],
    items: [{ kind: 'user', text: 'Hi' }, {
      kind: 'image',
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
      label: 'dot',
    }],
  })
})

let fails = async (run: Promise<unknown>) => {
  let { code, message, retry, response } = await assertRejects(
    () => run,
    ModelError,
  )
  return { code, message, retry, response }
}

test('a failure the serving provider expects reaches the caller as it was thrown', async () => {
  let limited = new ModelError('busy', 'slow down', { after: 2000 }, {
    body: '{"type":"rate_limit_error"}',
  })
  let served = await caller(await box(() => Promise.reject(limited)))
  assertEquals(await fails(served.box(ask())), {
    code: 'busy',
    message: 'slow down',
    retry: { after: 2000 },
    response: { body: '{"type":"rate_limit_error"}' },
  })
})

test('a model no provider of the serving host serves is refused', async () => {
  let served = await caller(await box(() => Promise.resolve(hello)))
  assertEquals(
    (await fails(served.box(ask({ model: 'gpt-9' })))).code,
    'provider',
  )
})

test('a bug on the serving host is reported there and the caller told only that it failed', async () => {
  let reported: unknown[] = []
  let bug = new TypeError('secret detail')
  let served = await caller(
    await box(() => {
      throw bug
    }, (error) => reported.push(error)),
  )
  assertEquals(await fails(served.box(ask())), {
    code: 'serving',
    message: 'the serving host failed (TypeError)',
    retry: undefined,
    response: undefined,
  })
  assertEquals(reported, [bug])
})

test('the caller stopping a step stops it on the serving host', async () => {
  let stopped = Promise.withResolvers<unknown>()
  let started = Promise.withResolvers<void>()
  let stub: Model = (req) =>
    new Promise((_, fail) => {
      req.onText?.({ index: 0, text: 'Thinking' })
      req.signal!.addEventListener('abort', () => {
        stopped.resolve(req.signal!.reason)
        fail(req.signal!.reason)
      })
    })
  let served = await caller(await box(stub))
  let stop = new AbortController()
  let reason = new Error('the person stopped it')
  let run = served.box(ask({
    signal: stop.signal,
    stallTimeout: 0,
    onText: () => started.resolve(),
  }))
  await started.promise
  stop.abort(reason)
  assertEquals(await assertRejects(() => run), reason)
  assertEquals(await stopped.promise, reason)
})

test("a quiet step outlasts the caller's stall timeout, and a host gone quiet stalls", async () => {
  let time = clock()
  let done = Promise.withResolvers<Reply>()
  let answer = await box(() => done.promise, undefined, time)
  let live = forwarding({
    fetch: (at, init) => answer(new Request(at, init)),
  }, { clock: time })
  let run = live(ask({ stallTimeout: BEAT / 1000 + 5 }))
  for (let i = 0; i < 4; i++) await time.advance(BEAT)
  done.resolve(hello)
  assertEquals((await run).id, 'r1')
  assertEquals(time.pending(), 0)

  let silent = forwarding({
    fetch: (_at, init) =>
      new Promise((_, fail) =>
        init!.signal!.addEventListener(
          'abort',
          () => fail(init!.signal!.reason),
        )
      ),
  }, { clock: time })
  let stalled = fails(silent(ask({ stallTimeout: 20 })))
  await time.advance(20_000)
  assertEquals([(await stalled).code, (await stalled).retry], ['stalled', {}])
})

test('a machine that does not answer is unreachable, and may pass', async () => {
  let down = forwarding({
    fetch: () => Promise.reject(new TypeError('connection refused')),
  })
  assertEquals(await fails(down(ask())), {
    code: 'unreachable',
    message: 'connection refused',
    retry: {},
    response: undefined,
  })
  let closed = forwarding({
    fetch: () => Promise.resolve(new Response('no', { status: 403 })),
  })
  assertEquals(await fails(closed(ask())), {
    code: 'unreachable',
    message: 'the serving host answered 403',
    retry: undefined,
    response: { body: 'no' },
  })
  let dropped = forwarding({
    fetch: () => Promise.resolve(new Response('data: {"first":true}\n\n')),
  })
  assertEquals((await fails(dropped(ask()))).code, 'unreachable')
})

test('a step asking for media is refused before it is sent, and a body that is no step is refused', async () => {
  let sent = 0
  let model = forwarding({
    fetch: () => (sent++, Promise.resolve(new Response(''))),
  })
  assertEquals(
    (await fails(model(ask({ modalities: ['image'] })))).code,
    'modalities',
  )
  assertEquals(sent, 0)
  let answer = await box(() => Promise.resolve(hello))
  let refused = await answer(
    new Request('http://machine' + PATH, { method: 'POST', body: '{}' }),
  )
  assertEquals(refused.status, 400)
})
