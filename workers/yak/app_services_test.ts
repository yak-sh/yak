import { whole } from '@yaks/query'
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { parseTools } from '@yaks/tools/declared'
import { keepDeclaration } from './declaration.ts'
import { releaseOf } from './directory.ts'
import { serviceOffer } from './app-services.ts'
import { as, SECRET, seeded, visit } from './serving-data-probe.ts'
import { platform } from './directory-rows-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import * as apps from './apps.ts'
import { answer as apex } from './apex.ts'
import { parseHTML } from 'linkedom'

test('app service catalog follows the declaration without copying a command schema', async () => {
  await using p = platform(SECRET)
  let { dir, space, app } = await seeded(p.env, 'private', p.dir)
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
import { ADA, ADA_OWNS } from './serving-data-probe.ts'
import type { Dispatch } from './door.ts'
import { assertRejects } from '@std/assert'

test('service customers retain their identity and lose authority after revocation', async () => {
  await using p = platform(SECRET)
  let { env } = p
  lifecycleStores(env)
  let source = await seeded(env, 'private', p.dir)
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
  let read = (q: unknown) => g.query(whole(String(q)))
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
  let connecting = async () =>
    apps.fetch(
      visit('/cookbook/api/service/connect', {
        method: 'POST',
        headers: { cookie: await as(eli), 'content-type': 'application/json' },
        body: JSON.stringify({ service: app.eid, operations: ['order'] }),
      }),
      env,
    )
  // Connecting requires access to the source app.
  let stranger = await connecting()
  assertEquals(stranger.status, 403)
  await stranger.body?.cancel()
  await dir.apply({
    entities: [{
      entity: { eid: '$guest' },
      grant: { app: source.app.eid, person: eli, access: 'viewer' },
    }],
  }, ADA_OWNS)
  let connect = await connecting()
  assertEquals(connect.status, 200)
  let pending = await connect.json() as { connection: string; url: string }
  let before = await apps.fetch(
    visit('/cookbook/api/service', {
      method: 'POST',
      headers: { cookie: await as(eli), 'content-type': 'application/json' },
      body: JSON.stringify({ service: app.eid, name: 'order', args: {} }),
    }),
    env,
  )
  assertEquals(before.status, 403)
  let consentPage = await apex(
    new Request(pending.url, {
      headers: { cookie: await as(eli) },
    }),
    env,
    '/connect/service',
  )
  assertEquals(consentPage.status, 200)
  assertStringIncludes(
    consentPage.headers.get('content-security-policy')!,
    "frame-ancestors 'none'",
  )
  let document = parseHTML(await consentPage.text()).document
  assertEquals(document.querySelector('li strong')?.textContent, 'order')
  assertStringIncludes(
    document.body.textContent!,
    'https://ada.yaks.app/cookbook/',
  )
  assertStringIncludes(
    document.body.textContent!,
    'https://printbound.yaks.app/prints/',
  )
  let fields = Object.fromEntries(
    [...document.querySelectorAll('input')].map((
      input,
    ) => [input.name, input.value]),
  )
  let approve = (sent: Record<string, string>, cookie: string) =>
    apex(
      new Request('https://yaks.app/connect/service', {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(sent),
      }),
      env,
      '/connect/service',
    )
  assertEquals(
    (await approve({ request: fields.request }, await as(eli))).status,
    403,
  )
  assertEquals(
    (await approve(
      { request: fields.request, consent: fields.request },
      await as(eli),
    )).status,
    403,
  )
  assertEquals((await approve(fields, await as(ADA))).status, 403)
  let bearerOnly = await apex(
    new Request(pending.url, {
      headers: { authorization: 'Bearer not-a-browser-session' },
    }),
    env,
    '/connect/service',
  )
  assertEquals(bearerOnly.status, 303)
  let changed = await apps.fetch(
    visit('/cookbook/api/service/connect', {
      method: 'POST',
      headers: { cookie: await as(eli), 'content-type': 'application/json' },
      body: JSON.stringify({ service: app.eid, operations: [] }),
    }),
    env,
  )
  let changedUrl = (await changed.json()).url
  assertEquals(
    (await approve({
      ...fields,
      request: new URL(changedUrl).searchParams.get('request')!,
    }, await as(eli))).status,
    403,
  )
  let approved = await approve(fields, await as(eli))
  assertEquals(approved.status, 303)
  assertEquals(
    approved.headers.get('location'),
    'https://ada.yaks.app/cookbook/',
  )
  await assertRejects(() =>
    connectService(env, dir, source, { person: ADA, role: 'owner' }, app.eid, [
      'admin',
    ])
  )
  let ada = await callService(
    env,
    dir,
    source,
    { person: ADA, role: 'owner' },
    app.eid,
    'order',
    {},
  )
  let call = (role: 'viewer' | null) =>
    callService(env, dir, source, { person: eli, role }, app.eid, 'order', {})
  await assertRejects(() => call(null))
  let other = await call('viewer')
  assertEquals(JSON.parse(String(ada.value.answer)).order, `private-${ADA}`)
  assertEquals(JSON.parse(String(other.value.answer)).order, `private-${eli}`)
  assertEquals(requests[0].headers.get('x-yak-role'), null)
  assertEquals(requests[0].headers.get('x-yak-app-eid'), app.eid)
  let provenance = JSON.parse(requests[0].headers.get('x-yak-command-source')!)
  let authority = (await serviceFrom(env, provenance.authority))!
  assertEquals(authority.person, ADA)
  assertEquals(authority.app, source.app.eid)
  assertEquals(await verifyService(env, dir, authority), true)
  let eliSource = JSON.parse(requests[1].headers.get('x-yak-command-source')!)
  let eliAuthority = (await serviceFrom(env, eliSource.authority))!
  assertEquals(await verifyService(env, dir, eliAuthority), true)
  let guest = (await dir.grant(source.app, eli))!
  await dir.apply({
    entities: [{ entity: { eid: guest.eid }, $delete: true }],
  }, ADA_OWNS)
  assertEquals(await verifyService(env, dir, eliAuthority), false)
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
