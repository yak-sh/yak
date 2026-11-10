import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { appStore, stamp, storeName } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'
import { platform } from './directory-rows-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import {
  ADA,
  ADA_OWNS,
  as,
  SECRET,
  seeded,
  visit,
} from './serving-data-probe.ts'
import { fetch } from './apps.ts'
import * as sell from './sell.ts'
import { protectedSale } from './sale-private.ts'
import { GRANT, owning } from './dispatch.ts'
import { COOKIE, seal, sign } from './lib/token.ts'

let ANA = 'a0000000-0000-4000-8000-000000000001'
let BO = 'b0000000-0000-4000-8000-000000000002'
let setup = async () => {
  let scenario = platform(SECRET)
  lifecycleStores(scenario.env)
  let { env } = scenario
  let { space, app } = await seeded(env, 'public', scenario.dir)
  await scenario.dir.apply({
    entities: [ANA, BO].map((eid) => ({
      entity: { eid },
      person: {},
    })),
  }, ADA_OWNS)
  let graph = metaOf(appStore(env.STORE, space, app, env), {
    ...KERNEL,
    'x-yak-person': app.eid,
    'x-yak-role': 'editor',
  })
  let cookies = new Map(
    await Promise.all(
      [ADA, ANA, BO].map(async (id) => [id, await as(id)] as const),
    ),
  )
  let ask = (path: string, person?: string, init: RequestInit = {}) =>
    fetch(
      visit(`/cookbook/api/${path}`, {
        ...init,
        headers: {
          ...person ? { cookie: cookies.get(person)! } : {},
          ...init.headers,
        },
      }),
      env,
    )
  return { env, space, app, graph, ask }
}

let orders = await setup()
let stored = crypto.randomUUID()
await orders.graph.apply(protectedSale([{
  entity: { eid: stored },
  doc: { title: 'Your private purchase' },
  order: {
    session: 'cs_private',
    intent: 'pi_private',
    account: 'acct_seller',
    items: '[]',
    total_cents: 1200,
    email: 'ana@example.com',
    status: 'paid',
  },
}], { buyer: ANA }))
await stamp(orders.env, {
  entities: [{
    entity: { eid: orders.space.eid },
    seller: { via: 'stripe', account: 'acct_seller', ready: true },
  }],
})
await sell.apply(orders.env, {
  account: 'acct_seller',
  about: 'sale',
  sale: {
    paid: true,
    status: 'paid',
    checkout: 'cs_webhook',
    payment: 'pi_webhook',
    total: 1200,
    email: 'bo@example.com',
    tags: { app: orders.app.slug, buyer: BO, items: '[]' },
  },
})

test('public catalog readers cannot query stored or webhook-created orders and mail', async () => {
  for (let person of [undefined, ANA, BO]) {
    for (let query of ['.order', '.sale_access', '.mail', '.email']) {
      let response = await orders.ask(
        `query?q=${encodeURIComponent(query)}`,
        person,
      )
      assertEquals(response.status, 200)
      assertEquals(await response.json(), [], `${person}: ${query}`)
    }
  }
  let seller = await orders.ask('query?q=.order', ADA)
  assertEquals((await seller.json()).length, 2)
})

test('each buyer receives only their own receipt without provider identifiers', async () => {
  let webhook = sell.orderEid('cs_webhook')
  for (let [id, buyer, other] of [[stored, ANA, BO], [webhook, BO, ANA]]) {
    for (let person of [undefined, other]) {
      assertEquals((await orders.ask(`pay/orders/${id}`, person)).status, 404)
    }
    let response = await orders.ask(`pay/orders/${id}`, buyer)
    assertEquals(
      response.status,
      200,
      JSON.stringify({
        buyer,
        rows: await orders.graph.query(
          `.entity.eid=${id} .order|.order.quote=${id}`,
        ),
        me: await (await orders.ask('me', buyer)).json(),
      }),
    )
    assertEquals(response.headers.get('cache-control'), 'private, no-store')
    let receipt = await response.json()
    assertEquals(receipt.order, {
      items: '[]',
      total_cents: 1200,
      status: 'paid',
    })
    assertEquals((await orders.ask(`pay/orders/${id}`, ADA)).status, 200)
  }
})

let files = await setup()
let upload = async (buyer: string, text: string) => {
  let response = await files.ask(`pay/artifacts?buyer=${buyer}`, ADA, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-yak-name': 'private.txt' },
    body: text,
  })
  assertEquals(response.status, 200, await response.clone().text())
  return await response.json() as { eid: string; url: string }
}
let first = await upload(ANA, 'private customer document')
let second = await upload(BO, 'different private document')
await upload(BO, 'private customer document')
let [representation] = await files.graph.query('.representation')

test('private artifact rows and ordinary blob paths disclose no bytes to catalog visitors', async () => {
  for (let person of [undefined, ANA, BO]) {
    for (let q of ['.attachment', '.blob', '.artifact', '.sale_artifact']) {
      let result = await files.ask(`query?q=${q}`, person)
      assertEquals(await result.json(), [])
    }
    let normal = await files.ask(`blob/${first.eid}`, person)
    assertEquals(normal.status, 404)
    assertEquals(
      (await files.ask(
        `blob/${first.eid}/${representation.entity.eid}`,
        person,
      )).status,
      404,
    )
  }
  for (let person of [undefined, ANA]) {
    assertEquals(
      (await files.ask(`pay/artifacts/${second.eid}`, person)).status,
      404,
    )
  }
  for (let person of [ANA, BO, ADA]) {
    let response = await files.ask(`pay/artifacts/${first.eid}`, person)
    assertEquals(response.status, 200)
    assertEquals(await response.text(), 'private customer document')
  }
})

test('seller renews scoped provider artifact links while strangers cannot mint them', async () => {
  assertEquals(
    (await files.ask(`pay/artifacts/${first.eid}/link`, undefined, {
      method: 'POST',
    })).status,
    404,
  )
  let response = await files.ask(`pay/artifacts/${first.eid}/link`, ANA, {
    method: 'POST',
  })
  let signed = await response.json() as { url: string; expires: number }
  assert(signed.expires > Date.now())
  let url = new URL(signed.url)
  let downloaded = await files.ask(
    url.pathname.slice('/cookbook/api/'.length) + url.search,
  )
  assertEquals(downloaded.status, 200)
  assertEquals(downloaded.headers.get('cache-control'), 'private, no-store')
  assertEquals(await downloaded.text(), 'private customer document')
  let wrong = url.pathname.replace(first.eid, second.eid)
  assertEquals(
    (await files.ask(wrong.slice('/cookbook/api/'.length) + url.search)).status,
    404,
  )
  let renewed = await files.ask(`pay/artifacts/${first.eid}/link`, ADA, {
    method: 'POST',
  })
  assertEquals(renewed.status, 200)
})

let guests = await setup()
let guestOrder = crypto.randomUUID()
let guestVia = crypto.randomUUID()
await guests.graph.apply(protectedSale([{
  entity: { eid: guestOrder },
  order: { items: '[]', total_cents: 10, status: 'paid' },
}], { via: guestVia }))
let guestCookie = `${COOKIE}=${await seal('browser', {
  via: guestVia,
  exp: Math.floor(Date.now() / 1000) + 60,
}, SECRET)}`
let continuedCookie = `${COOKIE}=${await sign({
  person: ANA,
  via: guestVia,
  space: null,
  exp: Math.floor(Date.now() / 1000) + 60,
}, SECRET)}`
test('guest receipts follow the verified browser through sign-in', async () => {
  for (let cookie of [guestCookie, continuedCookie]) {
    let response = await fetch(
      visit(`/cookbook/api/pay/orders/${guestOrder}`, {
        headers: { cookie },
      }),
      guests.env,
    )
    assertEquals(response.status, 200)
  }
  let forged = await guests.ask(`pay/orders/${guestOrder}`, BO, {
    headers: { 'x-yak-via': guestVia },
  })
  assertEquals(forged.status, 404)
})

let customerOnly = await upload(ANA, 'Only customer A may supply these bytes')
let artifactGuest = crypto.randomUUID()
let guestFileResponse = await files.ask(
  `pay/artifacts?via=${artifactGuest}`,
  ADA,
  {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'Guest source bytes',
  },
)
assertEquals(guestFileResponse.status, 200)
let guestFile = await guestFileResponse.json() as { eid: string }
let appGrant = await owning(
  SECRET,
  storeName(files.space, files.app),
  files.app,
)
let scheduled = (path: string, init: RequestInit = {}) =>
  files.ask(path, undefined, {
    ...init,
    headers: { ...init.headers, [GRANT]: appGrant },
  })
let restricted = (sha: string, customer: Record<string, string>) =>
  `pay/artifacts/${sha}?${new URLSearchParams({
    subject: 'customer',
    ...customer,
  })}`

test('scheduled artifact reads restrict merchant authority to the original person or guest', async () => {
  for (
    let [sha, customer, status] of [
      [customerOnly.eid, { buyer: ANA }, 200],
      [second.eid, { buyer: ANA }, 404],
      [customerOnly.eid, { buyer: BO }, 404],
      [second.eid, { buyer: BO }, 200],
      [guestFile.eid, { via: artifactGuest }, 200],
      [customerOnly.eid, { via: artifactGuest }, 404],
      [customerOnly.eid, { buyer: BO, via: artifactGuest }, 404],
      [guestFile.eid, { buyer: ANA, via: artifactGuest }, 200],
    ] as [string, Record<string, string>, number][]
  ) {
    assertEquals((await scheduled(restricted(sha, customer))).status, status)
  }
  let head = await scheduled(restricted(customerOnly.eid, { buyer: ANA }), {
    method: 'HEAD',
  })
  assertEquals(head.status, 200)
  assertEquals(await head.text(), '')
  assertEquals((await scheduled(`pay/artifacts/${second.eid}`)).status, 200)
})

test('restricted artifact reads fail closed on missing subjects and unprivileged subject selection', async () => {
  for (
    let query of [
      'subject=customer',
      'subject=',
      `buyer=${ANA}`,
      'subject=customer&buyer=&via=',
    ]
  ) {
    assertEquals(
      (await scheduled(`pay/artifacts/${customerOnly.eid}?${query}`)).status,
      400,
    )
  }
  for (let person of [undefined, ANA, BO]) {
    assertEquals(
      (await files.ask(restricted(customerOnly.eid, { buyer: ANA }), person, {
        headers: { 'x-yak-role': 'editor' },
      })).status,
      403,
    )
  }
  assertEquals(
    (await files.ask(`pay/artifacts/${customerOnly.eid}`, BO)).status,
    404,
  )
})

test('restricted artifact tickets require customer entitlement even beside a valid ticket', async () => {
  let wrong = restricted(second.eid, { buyer: ANA }).replace('?', '/link?')
  assertEquals((await scheduled(wrong, { method: 'POST' })).status, 404)
  let right = restricted(second.eid, { buyer: BO }).replace('?', '/link?')
  let response = await scheduled(right, { method: 'POST' })
  assertEquals(response.status, 200)
  let ticket = new URL((await response.json()).url)
  assertEquals(ticket.searchParams.has('buyer'), false)
  assertEquals(ticket.searchParams.has('subject'), false)
  ticket.searchParams.set('subject', 'customer')
  ticket.searchParams.set('buyer', ANA)
  assertEquals(
    (await scheduled(
      ticket.pathname.slice('/cookbook/api/'.length) + ticket.search,
    )).status,
    404,
  )
})
