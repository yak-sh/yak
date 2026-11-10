import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseTools } from '@yaks/tools/declared'
import { keepDeclaration } from './declaration.ts'
import { releaseOf } from './directory.ts'
import { serviceOffer } from './app-services.ts'
import { as, platform, seeded, visit } from './serving-probe.ts'
import * as apps from './apps.ts'

test('app service catalog follows the declaration without copying a command schema', async () => {
  await using p = platform()
  let { dir, space, app } = await seeded(p.env, 'private')
  let words = {
    $defs: {
      quote: {
        tool: true,
        description: 'Quote the exact book',
        revision: 'v2',
        floor: 'person',
        input: { quantity: { type: 'integer' } },
        required: ['quantity'],
        worker: '/quote',
        service: { pricing: 'Printing plus shipping, confirmed at checkout' },
      },
      internal: {
        tool: true,
        description: 'Private work',
        worker: '/internal',
      },
    },
  }
  await keepDeclaration(p.env, space, app, releaseOf(app), {
    vocab: {},
    tools: parseTools(words, []),
  })
  let offer = { name: 'books', hosts: [], service: { app: app.eid } }
  let found = await serviceOffer(p.env, dir, offer)
  assertEquals(found?.commands.map((c) => c.name), ['quote'])
  assertEquals(found?.commands[0].input.required, ['quantity'])
  assertEquals(found?.commands[0].floor, 'person')
  assertEquals(found?.commands[0].revision, 'v2')
  assertEquals(found?.commands[0].pricing, words.$defs.quote.service.pricing)
})

import { mint } from '@yaks/graph'
import { grantService, publishService } from '@yaks/connections'
import {
  callService,
  connectService,
  serviceFrom,
  verifyService,
} from './service-call.ts'
import { meta } from './meta.ts'
import { ADA, ADA_OWNS } from './serving-probe.ts'
import type { Dispatch } from './door.ts'
import { assertRejects } from '@std/assert'

test('service customers retain their identity and lose authority after revocation', async () => {
  await using p = platform()
  let { env } = p
  let source = await seeded(env, 'private')
  let { dir } = source
  let eli = mint()
  await dir.apply({
    entities: [
      {
        entity: { eid: '$merchant' },
        space: { slug: 'printbound', store: 'printbound' },
      },
      { entity: { eid: eli }, person: {} },
      {
        entity: { eid: '$prints' },
        app: {
          space: '$merchant',
          slug: 'prints',
          version: 1,
          access: 'private',
          store: 'printbound/prints.aaa111',
        },
      },
    ],
  }, ADA_OWNS)
  let merchant = (await dir.space('printbound'))!
  let app = (await dir.app(merchant, 'prints'))!
  let tools = parseTools({
    $defs: {
      order: {
        tool: true,
        description: 'This customer order',
        floor: 'person',
        worker: '/order',
        service: { pricing: 'Checkout required for purchases' },
      },
      admin: {
        tool: true,
        description: 'Merchant operation',
        floor: 'owner',
        worker: '/admin',
        service: { pricing: 'Internal' },
      },
    },
  }, [])
  await keepDeclaration(env, merchant, app, releaseOf(app), {
    vocab: {},
    tools,
  })
  let g = meta(env)
  let read = (q: unknown) => g.query(String(q))
  await g.apply(
    await publishService(read, {
      app: app.eid,
      owner: merchant.eid,
      listed: true,
    }),
  )
  let adaConnection = (await connectService(
    env,
    dir,
    source,
    { person: ADA, role: 'owner' },
    app.eid,
    ['order'],
  )).connection
  let connect = await apps.fetch(
    visit('/cookbook/api/service/connect', {
      method: 'POST',
      headers: { cookie: await as(eli), 'content-type': 'application/json' },
      body: JSON.stringify({ service: app.eid, operations: ['order'] }),
    }),
    env,
  )
  assertEquals(connect.status, 200, await connect.text())
  let graph = await apps.fetch(
    visit('/cookbook/api/query?.doc', {
      headers: { cookie: await as(eli) },
    }),
    env,
  )
  assertEquals(graph.status, 403)
  await assertRejects(() =>
    connectService(env, dir, source, { person: ADA, role: 'owner' }, app.eid, [
      'admin',
    ])
  )
  let requests: Request[] = []
  env.DISPATCH = {
    get: () => ({
      fetch: (req: Request) => {
        requests.push(req)
        return Promise.resolve(
          Response.json({
            order: `private-${req.headers.get('x-yak-person')}`,
          }),
        )
      },
    }),
  } as Dispatch
  let ada = await callService(
    env,
    dir,
    source,
    { person: ADA, role: 'owner' },
    app.eid,
    'order',
    {},
  )
  let other = await callService(
    env,
    dir,
    source,
    { person: eli, role: null },
    app.eid,
    'order',
    {},
  )
  assertEquals(JSON.parse(String(ada.value.answer)).order, `private-${ADA}`)
  assertEquals(JSON.parse(String(other.value.answer)).order, `private-${eli}`)
  assertEquals(requests[0].headers.get('x-yak-role'), null)
  assertEquals(requests[0].headers.get('x-yak-app-eid'), app.eid)
  let provenance = JSON.parse(requests[0].headers.get('x-yak-command-source')!)
  let authority = (await serviceFrom(env, provenance.authority))!
  assertEquals(authority.person, ADA)
  assertEquals(authority.app, source.app.eid)
  assertEquals(await verifyService(env, dir, authority), true)
  await assertRejects(() =>
    callService(
      env,
      dir,
      source,
      { person: ADA, role: 'owner' },
      app.eid,
      'admin',
      {},
    )
  )
  await g.apply(
    await grantService(read, {
      person: ADA,
      connection: adaConnection,
      operations: [],
    }),
  )
  assertEquals(await verifyService(env, dir, authority), false)
  await assertRejects(() =>
    callService(
      env,
      dir,
      source,
      { person: ADA, role: 'owner' },
      app.eid,
      'order',
      {},
    )
  )
})
