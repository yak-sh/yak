import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { connectionsDoc } from './vocab.ts'
import { listing } from './integrations.ts'
import { publishService } from './services.ts'

test('service publication updates one identity and withdrawal preserves customer connections', async () => {
  let vocab = loadVocab([kernelDoc, provenanceDoc, connectionsDoc])
  let g = graph({ vocab, storage: ram(vocab) })
  let app = mint(), owner = mint(), customer = mint(), order = mint()
  let offer = {
    app,
    owner,
    title: 'PrintBound',
    tagline: 'Print a book',
    listed: true,
  }
  await g.apply(await publishService(g.read, offer))
  let [found] = await listing(g.read, 'print book')
  assertEquals(found.service, { app })
  await g.apply([{
    entity: { eid: order },
    connection: {
      owner: customer,
      integration: found.name,
      status: 'connected',
    },
  }])
  await g.apply(
    await publishService(g.read, { ...offer, title: 'Bound books' }),
  )
  assertEquals((await listing(g.read))[0].name, found.name)
  await assertRejects(() =>
    publishService(g.read, { ...offer, owner: customer })
  )
  await g.apply(await publishService(g.read, { ...offer, listed: false }))
  assertEquals(await listing(g.read), [])
  assertEquals((await g.read('.connection')).length, 1)
})
