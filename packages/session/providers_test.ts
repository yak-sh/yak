// Provider selection enriches newly requested models when metadata is
// available, but metadata discovery never stands between an ask and its model.

import { assertEquals } from '@std/assert'
import { edgeDoc, edgeEid, edgeKeywords } from '@yaks/edge'
import { type Comp, graph, identityEid } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { type Model, modelDoc, ModelError } from '@yaks/model'
import { ram } from '@yaks/ram'
import { test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { answers, providerResolver } from './providers.ts'

test('metadata transport failure does not suppress a model ask', async () => {
  let vocab = loadVocab(
    [kernelDoc, edgeDoc, modelDoc],
    [kernelKeywords, edgeKeywords],
  )
  let g = graph({ storage: ram(vocab), vocab })
  let provider = identityEid('provider', ['fake'])
  let model = identityEid('model', ['release'])
  await g.apply([{
    entity: { eid: provider },
    provider: { name: 'fake' },
  }, {
    entity: { eid: model },
    model: { name: 'release', offered: false },
    pending: {},
  }, {
    entity: { eid: edgeEid(provider, 'serves', model) },
    edge: { from: provider, to: model },
    serves: { name: 'release' },
  }])

  let asks = 0
  let fake: Model = (req) => {
    asks++
    return Promise.resolve({ id: 'r1', model: req.model, items: [] })
  }
  fake.list = () => Promise.reject(new TypeError('tls handshake eof'))
  let resolve = providerResolver(g, { fake })
  let served = await resolve(
    { provider, model },
    (await g.get([model]))[0],
  )
  let reply = await served.model({ model: served.name, items: [], tools: [] })
  let [confirmed] = await g.get([model])

  assertEquals([asks, reply.id], [1, 'r1'])
  assertEquals(confirmed.model, { name: 'release', offered: true })
  assertEquals(confirmed.pending as Comp | undefined, undefined)
})

test('resolved provider snapshots dispatch retention on every reply and keeps explicit expiry', async () => {
  let vocab = loadVocab([kernelDoc, edgeDoc, modelDoc], [
    kernelKeywords,
    edgeKeywords,
  ])
  let g = graph({ storage: ram(vocab), vocab })
  let provider = identityEid('provider', ['cache-provider'])
  let model = identityEid('model', ['cached-model'])
  await g.apply([
    {
      entity: { eid: provider },
      provider: { name: 'cache-provider', cache_retention: 300 },
    },
    {
      entity: { eid: model },
      model: { name: 'cached-model' },
      price: { input: 0, output: 0 },
    },
    {
      entity: { eid: edgeEid(provider, 'serves', model) },
      edge: { from: provider, to: model },
      serves: { name: 'cached-model' },
    },
  ])
  let explicit: string | null | undefined
  let fake: Model = async (req) => {
    // A provider row changing while a request runs cannot change its snapshot.
    await g.apply([{
      entity: { eid: provider },
      provider: { cache_retention: null },
    }])
    return {
      id: 'r',
      model: req.model,
      items: [],
      ...explicit !== undefined ? { cacheExpiresAt: explicit } : {},
    }
  }
  let served = await providerResolver(g, { 'cache-provider': fake })(
    { provider },
    (await g.get([model]))[0],
  )
  let before = Date.now()
  let reply = await served.model({ model: served.name, items: [], tools: [] })
  let expiry = Date.parse(reply.cacheExpiresAt!)
  assertEquals(
    expiry >= before + 300_000 && expiry <= Date.now() + 300_000,
    true,
  )
  reply = await served.model({ model: served.name, items: [], tools: [] })
  assertEquals(reply.cacheExpiresAt, null)
  explicit = '2026-10-03T09:00:00Z'
  reply = await served.model({ model: served.name, items: [], tools: [] })
  assertEquals(reply.cacheExpiresAt, '2026-10-03T09:00:00.000Z')
  explicit = null
  reply = await served.model({ model: served.name, items: [], tools: [] })
  assertEquals(reply.cacheExpiresAt, null)
})

let discovery = async (pending = true) => {
  let vocab = loadVocab([kernelDoc, edgeDoc, modelDoc], [
    kernelKeywords,
    edgeKeywords,
  ])
  let g = graph({ storage: ram(vocab), vocab })
  let provider = identityEid('provider', ['discovery'])
  let ids = ['one', 'two'].map((name) => identityEid('model', [name]))
  await g.apply([
    {
      entity: { eid: provider },
      provider: { name: 'discovery' },
    },
    ...ids.flatMap((id, i) => [{
      entity: { eid: id },
      model: { name: ['one', 'two'][i] },
      ...pending ? { pending: {} } : {},
    }, {
      entity: { eid: edgeEid(provider, 'serves', id) },
      edge: { from: provider, to: id },
      serves: { name: ['one', 'two'][i] },
    }]),
  ])
  let asks = 0
  let fake: Model = (req) => {
    asks++
    return Promise.resolve({ id: `reply-${asks}`, model: req.model, items: [] })
  }
  let errors: unknown[] = []
  let resolve = providerResolver(
    g,
    { discovery: fake },
    undefined,
    undefined,
    (error) => errors.push(error),
  )
  let ask = async (id = ids[0]) => {
    let served = await resolve({ provider }, (await g.get([id]))[0])
    return served.model({ model: served.name, tools: [], items: [] })
  }
  return { g, ids, fake, errors, ask, asks: () => asks }
}

test('confirmed models without a price do not list models on any turn', async () => {
  let h = await discovery(false)
  let lists = 0
  h.fake.list = () => {
    lists++
    return Promise.resolve([])
  }
  await Promise.all(Array.from({ length: 5 }, () => h.ask()))
  await h.ask()
  assertEquals([lists, h.asks()], [0, 6])
})

test('concurrent pending models share one in-flight listing and retain an empty catalog', async () => {
  let h = await discovery()
  let lists = 0
  let release!: () => void
  let gate = new Promise<void>((resolve) => release = resolve)
  h.fake.list = async () => {
    lists++
    await gate
    return []
  }
  let batch = Promise.all(h.ids.map((id) => h.ask(id)))
  // Let both graph resolutions reach discovery while the provider is blocked.
  await new Promise((resolve) => setTimeout(resolve, 0))
  assertEquals(lists, 1)
  release()
  await batch
  // A newly requested model in the same runner must use the empty cache too.
  await h.g.apply([{ entity: { eid: h.ids[0] }, pending: {} }])
  await h.ask()
  assertEquals([lists, h.asks()], [1, 3])
})

test('transient metadata exhaustion reports once, cools down and never suppresses asks', async () => {
  let h = await discovery()
  let lists = 0
  let failure = new ModelError('http_429', 'Model listing says 429', {
    after: 120_000,
  })
  h.fake.list = () => {
    lists++
    return Promise.reject(failure)
  }
  let now = Date.now
  let clock = now()
  Date.now = () => clock
  try {
    await Promise.all(h.ids.map((id) => h.ask(id)))
    assertEquals([lists, h.asks(), h.errors], [1, 2, [failure]])
    await h.g.apply([{ entity: { eid: h.ids[0] }, pending: {} }])
    clock += 60_001
    await h.ask()
    assertEquals([lists, h.asks(), h.errors.length], [1, 3, 1])
    await h.g.apply([{ entity: { eid: h.ids[0] }, pending: {} }])
    clock += 60_000
    await h.ask()
    assertEquals([lists, h.asks(), h.errors.length], [2, 4, 2])
  } finally {
    Date.now = now
  }
})

test('metadata success and missing-price info are cached for five minutes', async () => {
  let h = await discovery(false)
  let infos = 0
  h.fake.info = (name) => {
    infos++
    return Promise.resolve({ name })
  }
  h.fake.list = () => {
    throw new Error('info must not list')
  }
  let now = Date.now
  let clock = now()
  Date.now = () => clock
  try {
    await Promise.all([h.ask(), h.ask()])
    assertEquals(infos, 1)
    clock += 299_999
    await h.ask()
    assertEquals(infos, 1)
    clock += 2
    await h.ask()
    assertEquals(infos, 2)
  } finally {
    Date.now = now
  }
})

test('process providers with native implementations do not take managed sessions', async () => {
  let { sessionDoc } = await import('./vocab.ts')
  let vocab = loadVocab([kernelDoc, edgeDoc, modelDoc, sessionDoc], [
    kernelKeywords,
    edgeKeywords,
  ])
  let g = graph({ storage: ram(vocab), vocab })
  let provider = identityEid('provider', ['claude'])
  await g.apply([
    {
      entity: { eid: provider },
      provider: { name: 'claude', transport: 'process' },
    },
    { entity: { eid: 'managed' }, session: {} },
    { entity: { eid: 'native' }, session: {}, native: {} },
  ])
  let fake: Model = (req) =>
    Promise.resolve({ id: 'x', model: req.model, items: [] })
  let check = answers(g, { claude: fake })
  assertEquals(await check({ provider }, 'managed'), false)
  assertEquals(await check({ provider }, 'native'), true)
})
