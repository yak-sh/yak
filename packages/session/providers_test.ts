// Provider selection enriches newly requested models when metadata is
// available, but metadata discovery never stands between an ask and its model.

import { assertEquals } from '@std/assert'
import { edgeDoc, edgeEid, edgeKeywords } from '@yaks/edge'
import { type Comp, graph, identityEid } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { type Model, modelDoc } from '@yaks/model'
import { ram } from '@yaks/ram'
import { test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { providerResolver } from './providers.ts'

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
