import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { platformDoc } from '@yaks/platform/vocab'
import { connectionsDoc } from './vocab.ts'
import { listing } from './integrations.ts'
import { publishService } from './services.ts'

test('service publication updates one identity and withdrawal preserves customer connections', async () => {
  let vocab = loadVocab([kernelDoc, provenanceDoc, platformDoc, connectionsDoc])
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

test('service authority is person and operation scoped and revocation reaches delayed work', async () => {
  let { edgeDoc, edgeEid } = await import('@yaks/edge')
  let { grantService, serviceAuthority, serviceName } = await import(
    './services.ts'
  )
  let vocab = loadVocab([kernelDoc, provenanceDoc, connectionsDoc, edgeDoc])
  let g = graph({ vocab, storage: ram(vocab) })
  let person = mint(),
    stranger = mint(),
    app = mint(),
    service = mint(),
    space = mint(),
    connection = mint()
  await g.apply([{
    entity: { eid: connection },
    connection: {
      owner: person,
      integration: serviceName(service),
      status: 'needed',
    },
  }, {
    entity: { eid: edgeEid(app, 'uses', connection) },
    edge: { from: app, to: connection },
    uses: { each: true },
  }])
  let authority = {
    person,
    app,
    space,
    service,
    connection,
    operation: 'status',
  }
  assertEquals(await serviceAuthority(g.read, authority), false)
  await g.apply(
    await grantService(g.read, { person, connection, operations: ['status'] }),
  )
  assertEquals(await serviceAuthority(g.read, authority), true)
  assertEquals(
    await serviceAuthority(g.read, { ...authority, person: stranger }),
    false,
  )
  assertEquals(
    await serviceAuthority(g.read, { ...authority, operation: 'purchase' }),
    false,
  )
  assertEquals(
    await serviceAuthority(g.read, { ...authority, app: mint() }),
    false,
  )
  await assertRejects(() =>
    grantService(g.read, {
      person: stranger,
      connection,
      operations: ['purchase'],
    })
  )
  await g.apply(
    await grantService(g.read, { person, connection, operations: [] }),
  )
  assertEquals(await serviceAuthority(g.read, authority), false)
})
