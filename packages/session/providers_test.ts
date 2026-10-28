// Provider selection enriches newly requested models when metadata is
// available, but metadata discovery never stands between an ask and its model.

import { assertEquals } from '@std/assert'
import { edgeDoc, edgeEid, edgeKeywords } from '@yaks/edge'
import { type Comp, graph, identityEid } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { type Model, modelDoc, ModelError } from '@yaks/model'
import { ram } from '@yaks/ram'
import { clock, test } from '@yaks/testing'
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

let discovery = async (pending = true, time = clock()) => {
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
    time,
  )
  let ask = async (id = ids[0]) => {
    let served = await resolve({ provider }, (await g.get([id]))[0])
    return served.model({ model: served.name, tools: [], items: [] })
  }
  return { g, ids, fake, errors, ask, asks: () => asks }
}

// Drive separate real graph/resolver scenarios while the module prepares. Each
// assertion below observes a frozen outcome; no test depends on another test's
// graph, clock, or execution order.

let confirmedWithoutPrice = await (async () => {
  let h = await discovery(false)
  let lists = 0
  h.fake.list = () => {
    lists++
    return Promise.resolve([])
  }
  await Promise.all(Array.from({ length: 5 }, () => h.ask()))
  await h.ask()
  return Object.freeze({ lists, asks: h.asks() })
})()

test('confirmed models without a price do not list models on any turn', () => {
  assertEquals(confirmedWithoutPrice, { lists: 0, asks: 6 })
})

let concurrentDiscovery = await (async () => {
  let h = await discovery()
  let lists = 0
  let release!: () => void
  let entered!: () => void
  let gate = new Promise<void>((resolve) => release = resolve)
  let started = new Promise<void>((resolve) => entered = resolve)
  h.fake.list = async () => {
    lists++
    entered()
    await gate
    return []
  }
  let batch = Promise.all(h.ids.map((id) => h.ask(id)))
  await started
  // Drain the graph/resolver continuations while the listing stays blocked.
  // No wall-clock sleep: both pending asks must share this unresolved result.
  for (let i = 0; i < 20; i++) await Promise.resolve()
  let inFlight = lists
  release()
  await batch
  let afterBatch = Object.freeze({ lists, asks: h.asks() })
  await h.g.apply([{ entity: { eid: h.ids[0] }, pending: {} }])
  await h.ask()
  return Object.freeze({
    inFlight,
    afterBatch,
    afterEmptyCache: Object.freeze({ lists, asks: h.asks() }),
  })
})()

test('concurrent pending models share one in-flight listing', () => {
  assertEquals(concurrentDiscovery.inFlight, 1)
  assertEquals(concurrentDiscovery.afterBatch, { lists: 1, asks: 2 })
})

test('an empty discovery catalog is retained for a newly pending model', () => {
  assertEquals(concurrentDiscovery.afterEmptyCache, { lists: 1, asks: 3 })
})

let exhaustedDiscovery = await (async () => {
  let time = clock(1_800_000_000_000)
  let h = await discovery(true, time)
  let lists = 0
  let failure = new ModelError('http_429', 'Model listing says 429', {
    after: 120_000,
  })
  h.fake.list = () => {
    lists++
    return Promise.reject(failure)
  }
  let snapshot = () =>
    Object.freeze({
      lists,
      asks: h.asks(),
      reports: h.errors.length,
      originalError: h.errors.every((error) => error === failure),
    })
  await Promise.all(h.ids.map((id) => h.ask(id)))
  let initial = snapshot()
  await h.g.apply([{ entity: { eid: h.ids[0] }, pending: {} }])
  await time.advance(60_001)
  await h.ask()
  let duringCooldown = snapshot()
  await h.g.apply([{ entity: { eid: h.ids[0] }, pending: {} }])
  await time.advance(60_000)
  await h.ask()
  return Object.freeze({ initial, duringCooldown, afterCooldown: snapshot() })
})()

test('transient metadata exhaustion reports once without suppressing concurrent asks', () => {
  assertEquals(exhaustedDiscovery.initial, {
    lists: 1,
    asks: 2,
    reports: 1,
    originalError: true,
  })
})

test('metadata failure cooldown honors the longer provider retry delay', () => {
  assertEquals(exhaustedDiscovery.duringCooldown, {
    lists: 1,
    asks: 3,
    reports: 1,
    originalError: true,
  })
})

test('metadata discovery retries after the provider cooldown expires', () => {
  assertEquals(exhaustedDiscovery.afterCooldown, {
    lists: 2,
    asks: 4,
    reports: 2,
    originalError: true,
  })
})

let infoCache = await (async () => {
  let time = clock(1_800_000_000_000)
  let h = await discovery(false, time)
  let infos = 0
  h.fake.info = (name) => {
    infos++
    return Promise.resolve({ name })
  }
  h.fake.list = () => {
    throw new Error('info must not list')
  }
  await Promise.all([h.ask(), h.ask()])
  let concurrent = infos
  await time.advance(299_999)
  await h.ask()
  let beforeExpiry = infos
  await time.advance(2)
  await h.ask()
  return Object.freeze({ concurrent, beforeExpiry, afterExpiry: infos })
})()

test('missing-price metadata shares concurrent per-model info requests', () => {
  assertEquals(infoCache.concurrent, 1)
})

test('metadata without pricing remains cached before five minutes', () => {
  assertEquals(infoCache.beforeExpiry, 1)
})

test('metadata without pricing refreshes after five minutes', () => {
  assertEquals(infoCache.afterExpiry, 2)
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
