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
