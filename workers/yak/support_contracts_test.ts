import { assertEquals, assertStringIncludes } from '@std/assert'
import { stub } from '@std/testing/mock'
import { contractEid, CONTRACTS, dayOf } from '@yaks/platform/support-contract'
import { managePath } from '@yaks/platform/routes'
import { test } from '@yaks/testing'
import { operatorDoor } from './build-door.ts'
import type { Env } from './env.ts'
import { fresh, signIn } from './probe.ts'

test('support billing uses the space plan, and members ask Jeff privately', async () => {
  let env!: Env
  let k = await fresh({
    STRIPE_KEY: 'sk_test_plan',
    STRIPE_INVOICE_KEY: 'rk_test_invoices',
    STRIPE_PRICE_PRO_YEAR: 'price_pro_year',
  }, (bindings) => env = bindings)
  let checks = await signIn(k, `checks@${k.host}`)
  let space = await k.dir.own(checks.person)
  let jeff = await k.dir.own(k.owner.person)
  let contract = contractEid(space.eid)
  let guest = await signIn(k)
  let stripe = globalThis.fetch
  let start = dayOf(Date.now())
  let year = Number(start.slice(0, 4))
  let renewal = dayOf(Date.UTC(year + 1, 0, 1))
  let seen: string[] = []
  let items = {
    data: [
      { price: { id: 'price_pro_year' } },
      {
        metadata: { yaks_add_on: contract },
        price: { id: 'price_support', unit_amount: 12345 },
      },
    ],
  }
  let sub = {
    id: 'sub_checks',
    customer: 'cus_checks',
    status: 'active',
    collection_method: 'send_invoice',
    metadata: { space: space.eid, support_contract: contract },
    created: Math.floor(Date.now() / 1000),
    current_period_end: Date.parse(renewal) / 1000,
    items,
  }
  let post = (cookie: string, fields: Record<string, string>) =>
    k.at(k.host, CONTRACTS, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ space: space.slug, ...fields }),
    })
  let invoices: object[] = []
  using _ = stub(globalThis, 'fetch', async (input, init) => {
    let req = new Request(input, init)
    let url = new URL(req.url)
    if (url.hostname != 'api.stripe.com') return await stripe(input, init)
    let path = url.pathname
    let form = new URLSearchParams(await req.text())
    let writes = req.method == 'POST'
    let dedicated = /\/v1\/(products|invoices|invoiceitems)(\/|$)/.test(path)
    assertEquals(
      req.headers.get('authorization'),
      dedicated ? 'Bearer rk_test_invoices' : 'Bearer sk_test_plan',
    )
    if (writes) seen.push(path)
    if (path == '/v1/customers') return Response.json({ id: sub.customer })
    if (path == '/v1/customers/cus_checks') {
      return Response.json({ email: checks.email, name: checks.name })
    }
    if (path == '/v1/products/prod_yaks_support_contract') {
      return Response.json({ id: 'prod_yaks_support_contract' })
    }
    if (path == '/v1/subscriptions/sub_checks') return Response.json(sub)
    if (path == '/v1/subscriptions') {
      if (!writes) return Response.json({ data: [], has_more: false })
      assertEquals(form.get('items[0][price]'), 'price_pro_year')
      assertEquals(form.get('items[1][price_data][unit_amount]'), '12345')
      assertEquals(
        form.get('items[1][price_data][recurring][interval]'),
        'year',
      )
      assertEquals(
        form.get('payment_settings[payment_method_types][0]'),
        'card',
      )
      assertEquals(
        form.get('payment_settings[payment_method_types][1]'),
        'us_bank_account',
      )
      return Response.json(sub)
    }
    if (path == '/v1/invoices') {
      if (!writes) return Response.json({ data: invoices, has_more: false })
      assertEquals(
        form.get('payment_settings[payment_method_types][0]'),
        'card',
      )
      assertEquals(
        form.get('payment_settings[payment_method_types][1]'),
        'us_bank_account',
      )
      return Response.json({ id: 'in_checks', status: 'draft' })
    }
    if (path == '/v1/invoiceitems') {
      assertEquals(form.get('invoice'), 'in_checks')
      assertEquals(form.get('amount'), '8765')
      return Response.json({ id: 'ii_checks' })
    }
    if (path == '/v1/invoices/in_checks/finalize') {
      let invoice = {
        id: 'in_checks',
        status: 'open',
        metadata: { yaks_once: contract },
      }
      invoices.push(invoice)
      return Response.json(invoice)
    }
    throw new Error(`Unexpected Stripe request ${req.method} ${path}`)
  })
  let terms = {
    op: 'set',
    annual: '123.45',
    onboarding: '87.65',
    hours: '3.50',
    email: 'jeff@example.com',
    phone: '+12695550100',
    start,
    renewal,
    billing: 'platform',
    billing_email: 'checks@example.com',
  }
  let read = async (cookie: string, url: string) =>
    (await k.at(k.host, url, { headers: { cookie, accept: 'text/html' } }))
      .text()
  let denied = await post(guest.cookie, terms)
  assertEquals(denied.status, 404)
  await denied.body?.cancel()
  for (let _ of [0, 1]) {
    let posted = await post(k.owner.cookie, terms)
    assertEquals(await posted.json().then((r) => r.billing), {
      subscription: 'sub_checks',
      invoice: 'in_checks',
    })
  }
  assertEquals(seen.filter((path) => path == '/v1/subscriptions'), [
    '/v1/subscriptions',
  ])
  assertEquals(seen.filter((path) => path == '/v1/invoiceitems'), [
    '/v1/invoiceitems',
  ])
  let log = await post(k.owner.cookie, {
    op: 'log',
    minutes: '75',
    note: 'Update the office hours',
  })
  assertEquals(await log.json().then((r) => [r.used, r.left]), [75, 135])
  let billing = managePath('billing', space.slug)
  let privatePage = await read(guest.cookie, billing)
  assertEquals(privatePage.includes('mailto:jeff@example.com'), false)
  let page = await read(checks.cookie, billing)
  assertStringIncludes(page, '1.25 hours used · 2.25 hours left this month')
  assertStringIncludes(page, 'mailto:jeff@example.com')
  assertStringIncludes(page, 'tel:+12695550100')
  let words = {
    op: 'request',
    id: crypto.randomUUID(),
    message: 'Can you update the website?',
  }
  let blocked = await post(guest.cookie, words)
  assertEquals(blocked.status, 404)
  await blocked.body?.cancel()
  for (let _ of [0, 1]) {
    let sent = await post(checks.cookie, words)
    assertEquals(sent.status, 303)
    await sent.body?.cancel()
  }
  let { updates } = await operatorDoor(
    env,
    jeff,
    { person: k.owner.person, role: 'owner' },
    'updates',
    {},
  ) as { updates: { needs: boolean; words: string }[] }
  assertEquals(
    updates.filter((u) => u.words.includes(words.message)).map((u) => u.needs),
    [true],
  )
  let admin = await read(k.owner.cookie, '/admin/support-contracts')
  assertStringIncludes(admin, '1.25 hours used · 2.25 hours left this month')
  assertStringIncludes(
    await read(k.owner.cookie, `/admin/${space.eid}`),
    'Update the office hours',
  )
  let client = await k.dir.own(guest.person)
  await k.dir.stamp({
    entities: [{
      entity: { eid: crypto.randomUUID() },
      member: { space: client.eid, person: checks.person, role: 'editor' },
    }],
  })
  let before = seen.length
  let partner = await post(k.owner.cookie, {
    ...terms,
    space: client.slug,
    provider: checks.email,
    billing: 'terms',
  })
  let partnerContract = await partner.json()
  assertEquals(partnerContract.contract.provider, checks.person)
  assertEquals(partnerContract.billing, undefined)
  let work = await post(checks.cookie, {
    op: 'log',
    provider_log: '1',
    space: client.slug,
    minutes: '30',
    note: 'Add the calendar',
  })
  assertEquals(work.status, 303)
  await work.body?.cancel()
  let clientView = await read(guest.cookie, managePath('billing', client.slug))
  assertStringIncludes(
    clientView,
    `Contact ${await k.dir.nameAt(checks.person)}`,
  )
  assertStringIncludes(clientView, '0.5 hours used · 3 hours left this month')
  assertEquals(seen.length, before)
})
