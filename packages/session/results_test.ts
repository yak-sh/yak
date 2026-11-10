import { assertEquals, assertRejects } from '@std/assert'
import { cleanup, test } from '@yaks/testing'
import { type Bundle, type Comp, graph, identityEid } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { artifactDoc } from '@yaks/blob/vocab'
import { effectDoc, effects } from '@yaks/effects'
import { executionComputed, toolsDoc } from '@yaks/tools'
import {
  type Model,
  modelDoc,
  type ModelResult,
  modelResults,
} from '@yaks/model'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { attemptComputed } from './attempt.ts'
import { react } from './react.ts'
import { running } from './run.ts'
import { compactAsk } from './compact_ask.ts'

let vocab = loadVocab([
  {
    $defs: {
      receipt_note: {
        component: true,
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
  },
  kernelDoc,
  provenanceDoc,
  docDoc,
  edgeDoc,
  artifactDoc,
  effectDoc,
  sessionDoc,
  modelDoc,
  toolsDoc,
], [kernelKeywords, edgeKeywords])
let model = identityEid('model', ['result-model'])
let provider = identityEid('provider', ['result-provider'])
let fixture = async (pooled = false) => {
  let fx = effects(vocab, { defer: true })
  let g = graph({
    storage: ram(vocab, {
      computed: { ...attemptComputed, ...executionComputed },
    }),
    vocab,
    plugins: [sessions(), ...pooled ? [fx] : []],
  })
  let session = crypto.randomUUID()
  let input = crypto.randomUUID()
  await g.apply([
    { entity: { eid: 'holder' } },
    { entity: { eid: model }, model: { name: 'result-model' } },
    { entity: { eid: provider }, provider: { name: 'result-provider' } },
    { entity: { eid: session }, session: {} },
    {
      entity: { eid: input },
      entry: { session },
      using: { model, provider },
      content: { body: 'Please continue' },
    },
  ])
  cleanup(() => fx.stop())
  return { g, fx, session, input, results: modelResults(g) }
}
let answer: ModelResult = {
  mark: { receipt_note: { id: 'saved-mark' } },
  reply: {
    id: 'reply',
    model: 'result-model',
    items: [{ kind: 'assistant', id: 'text', text: 'Finished reply' }],
    usage: { input_tokens: 10, output_tokens: 5 },
    cost: 0.001,
    costReported: false,
  },
}
let interrupted = await fixture()
let replayed = await fixture(true)
let raced = await fixture(true)
let reordered = await fixture()
let stopped = await fixture(true)
let passive = await fixture(true)
let passiveRace = await fixture(true)
let unknown = await fixture()
let omitted = await fixture()

// A successful provider returns, but the final transcript transaction fails.
let cut = (f: Awaited<ReturnType<typeof fixture>>) => ({
  ...f.g,
  apply: (rows: Bundle[], opts?: Parameters<typeof f.g.apply>[1]) => {
    if (rows.some((b) => (b.attempt as Comp | undefined)?.by === null)) {
      return Promise.reject(new Error('transcript write interrupted'))
    }
    return f.g.apply(rows, opts)
  },
})
let purchase = (f: Awaited<ReturnType<typeof fixture>>, saved = answer) => {
  let purchases = 0
  let served: Model = Object.assign(async (req: Parameters<Model>[0]) => {
    purchases++
    req.onText?.({ index: 0, id: 'text', text: 'Finished' })
    await f.results.save(req.call!, saved)
    return saved.reply
  }, { result: f.results.read })
  return { served, count: () => purchases }
}
let requests = (f: Awaited<ReturnType<typeof fixture>>) =>
  f.g.read(`.entry.session=${f.session}&.ask&*`)
let outcomes = (f: Awaited<ReturnType<typeof fixture>>) => f.g.read('.output&*')
let runner = (f: Awaited<ReturnType<typeof fixture>>, served: Model) =>
  running(f.g, { holder: 'holder', model: served, tools: [] })

test('a saved result recovers usage, cost and the existing streamed text on its original ask', async () => {
  let f = interrupted
  let { served, count } = purchase(f)
  await assertRejects(
    () =>
      react(cut(f), f.session, {
        model: served,
        tools: [],
        streaming: true,
        checkpointMs: 0,
      }),
    Error,
    'transcript write interrupted',
  )
  let [ask] = await requests(f)
  assertEquals((ask.attempt as Comp).state, 'inflight')
  let result = await react(f.g, f.session, {
    model: served,
    tools: [],
    streaming: true,
  })
  assertEquals(result.status, 'settled')
  let [done] = await requests(f)
  assertEquals(done.entity.eid, ask.entity.eid)
  assertEquals(done.receipt_note, { id: 'saved-mark' })
  assertEquals(done.usage, answer.reply.usage)
  assertEquals(done.cost, { dollars: 0.001, reported: false })
  assertEquals((await outcomes(f)).map((b) => (b.content as Comp)?.body), [
    'Finished reply',
  ])
  assertEquals(count(), 1)
})

test('result work after inline delivery keeps one reply, call and answer', async () => {
  let f = replayed
  let { served, count } = purchase(f, {
    ...answer,
    reply: {
      ...answer.reply,
      items: [...answer.reply.items, {
        kind: 'call',
        id: 'call',
        name: 'read',
        args: '{}',
      }],
      answers: { approved: { type: 'noul', noul: 1 } },
      cut: true,
    },
  })
  let handlers = runner(f, served)
  f.fx.handle({ session_result: handlers.session_result })
  await react(f.g, f.session, { model: served, tools: [] })
  await f.fx.work(f.g)
  assertEquals((await requests(f)).length, 1)
  assertEquals((await f.g.read('.call')).length, 1)
  assertEquals((await f.g.read('.answer')).length, 1)
  assertEquals((await f.g.read('.cut')).length, 1)
  assertEquals(count(), 1)
})

test('saved result delivery finishes an original request after its session stops without running its tools', async () => {
  let f = stopped
  let { served, count } = purchase(f, {
    ...answer,
    reply: {
      ...answer.reply,
      items: [{ kind: 'call', id: 'stop-call', name: 'read', args: '{}' }],
    },
  })
  let handlers = runner(f, served)
  f.fx.handle({ session_result: handlers.session_result })
  await assertRejects(() =>
    react(cut(f), f.session, { model: served, tools: [] })
  )
  await f.g.apply([{
    entity: { eid: crypto.randomUUID() },
    entry: { session: f.session },
    stop: {},
  }])
  await f.fx.work(f.g)
  let [ask] = await requests(f)
  assertEquals((ask.attempt as Comp).state, 'completed')
  assertEquals(ask.cost, { dollars: 0.001, reported: false })
  assertEquals((await f.g.read('.result')).length, 0)
  assertEquals(count(), 1)
})

test('durable result work finishes a passive compaction exchange whose transcript is settled', async () => {
  let f = passive
  let { served, count } = purchase(f)
  let handlers = runner(f, served)
  f.fx.handle({ session_result: handlers.session_result })
  await assertRejects(() =>
    compactAsk(cut(f), f.session, f.input, {
      model: served,
      name: 'result-model',
      provider,
    }, { model: 'result-model', items: [], tools: [] })
  )
  let [ask] = await f.g.read('.ask&*')
  await f.fx.work(f.g)
  let [done] = await f.g.get([ask.entity.eid])
  assertEquals((done.attempt as Comp).state, 'completed')
  assertEquals(done.usage, answer.reply.usage)
  assertEquals(done.cost, { dollars: 0.001, reported: false })
  assertEquals((await outcomes(f)).map((b) => (b.content as Comp)?.body), [
    'Finished reply',
  ])
  assertEquals(count(), 1)
})

test('an uncertain interrupted request with no saved result stays unpriced', async () => {
  let f = unknown
  let call = crypto.randomUUID()
  await f.g.apply([{
    entity: { eid: call },
    entry: { session: f.session },
    ask: { to: model, through: f.input },
    attempt: { by: 'holder' },
  }])
  let served: Model = Object.assign(
    () => Promise.reject(new Error('must not purchase')),
    { result: f.results.read },
  )
  await react(f.g, f.session, { model: served, tools: [] })
  let [ask] = await f.g.get([call])
  assertEquals(ask.cost, undefined)
  assertEquals((ask.interrupted as Comp).code, 'restart')
  assertEquals(await f.results.read(call), undefined)
})

test('saved completion that omits a streamed item preserves that partial and its measured cost', async () => {
  let f = omitted
  let call = crypto.randomUUID()
  await f.g.apply([
    {
      entity: { eid: call },
      entry: { session: f.session },
      ask: { to: model, through: f.input },
      attempt: { by: 'holder' },
    },
    {
      entity: { eid: crypto.randomUUID() },
      entry: { session: f.session },
      output: { source: call },
      stream_item: { index: 0, id: 'text' },
      content: { body: 'Finished' },
    },
  ], { trusted: true })
  await f.results.save(call, {
    ...answer,
    reply: { ...answer.reply, items: [] },
  })
  let served: Model = Object.assign(
    () => Promise.reject(new Error('must not purchase')),
    { result: f.results.read },
  )
  await react(f.g, f.session, { model: served, tools: [], streaming: true })
  let [ask] = await requests(f)
  assertEquals((ask.interrupted as Comp).code, 'superseded')
  assertEquals(ask.cost, { dollars: 0.001, reported: false })
  assertEquals(
    (await outcomes(f)).filter((b) => b.content && !b.answer).map((b) =>
      (b.content as Comp).body
    ),
    ['Finished'],
  )
})

test('result work completes while the original provider return is held, and inline completion loses harmlessly', async () => {
  let f = raced
  let purchases = 0
  let saved = Promise.withResolvers<void>()
  let returned = Promise.withResolvers<void>()
  let reply = {
    ...answer.reply,
    items: [...answer.reply.items, {
      kind: 'call' as const,
      id: 'race-call',
      name: 'read',
      args: '{}',
    }],
    answers: { approved: { type: 'noul' as const, noul: 1 } },
  }
  let served: Model = Object.assign(async (req: Parameters<Model>[0]) => {
    purchases++
    req.onText?.({ index: 0, id: 'text', text: 'Finished' })
    await f.results.save(req.call!, { reply })
    saved.resolve()
    await returned.promise
    return reply
  }, { result: f.results.read })
  f.fx.handle({ session_result: runner(f, served).session_result })
  let inline = react(f.g, f.session, {
    model: served,
    tools: [],
    streaming: true,
    checkpointMs: 0,
  })
  await saved.promise
  try {
    await f.fx.work(f.g)
    assertEquals(((await requests(f))[0].attempt as Comp).state, 'completed')
  } finally {
    returned.resolve()
  }
  await inline
  assertEquals(
    (await outcomes(f)).filter((b) => b.content && !b.answer).map((b) =>
      (b.content as Comp).body
    ),
    ['Finished reply'],
  )
  assertEquals((await f.g.read('.call')).length, 1)
  assertEquals((await f.g.read('.answer')).length, 1)
  assertEquals(purchases, 1)
})

test('reordered saved text replaces its own streamed item by id', async () => {
  let f = reordered
  let call = crypto.randomUUID()
  await f.g.apply([
    {
      entity: { eid: call },
      entry: { session: f.session },
      ask: { to: model, through: f.input },
      attempt: { by: 'holder' },
    },
    ...['first', 'second'].map((id, index) => ({
      entity: { eid: crypto.randomUUID() },
      entry: { session: f.session },
      output: { source: call },
      stream_item: { index, id },
      content: { body: id + ' partial' },
    })),
  ], { trusted: true })
  await f.results.save(call, {
    ...answer,
    reply: {
      ...answer.reply,
      items: ['second', 'first'].map((id) => ({
        kind: 'assistant' as const,
        id,
        text: id + ' done',
      })),
    },
  })
  let served: Model = Object.assign(
    () => Promise.reject(new Error('must not purchase')),
    { result: f.results.read },
  )
  await react(f.g, f.session, { model: served, tools: [] })
  assertEquals(
    (await outcomes(f)).map((
      b,
    ) => [(b.stream_item as Comp).id, (b.content as Comp).body]).sort(),
    [['first', 'first done'], ['second', 'second done']],
  )
})

test('passive recovery winning inline completion preserves its saved provider marks', async () => {
  let f = passiveRace
  let purchases = 0
  let served: Model = Object.assign(async (req: Parameters<Model>[0]) => {
    purchases++
    await f.results.save(req.call!, answer)
    await f.fx.work(f.g)
    return answer.reply
  }, {
    result: f.results.read,
    mark: () => ({ receipt_note: { id: 'recomputed-mark' } }),
  })
  f.fx.handle({ session_result: runner(f, served).session_result })
  await compactAsk(f.g, f.session, f.input, {
    model: served,
    name: 'result-model',
    provider,
  }, { model: 'result-model', items: [], tools: [] })
  let [ask] = await f.g.read('.ask&*')
  assertEquals(ask.receipt_note, { id: 'saved-mark' })
  assertEquals((await outcomes(f)).length, 1)
  assertEquals(purchases, 1)
})
