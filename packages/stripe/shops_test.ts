// Stripe's shops (shops.ts): what each call puts on the wire, and the events
// Stripe posts about a connected account read into the host's words, against
// a Stripe stood in by `fetch`.
//
// The controller properties are pinned in full, and that is the point of the
// first test. They are four sentences about who is responsible for what — who
// pays Stripe's fee, who carries a lost dispute, who gets a dashboard, who
// collects the identity documents — and every one of them is a promise made to
// a seller on the terms page and a liability decision for the platform. A diff
// that moves one is a diff that has to say so out loud.
import { equal, test } from '@yaks/testing'
import { stub } from '@std/testing/mock'
import type { Sale } from '@yaks/host/payments'
import { shopped, shops } from './shops.ts'

// Stripe, answering each call with `answer(path)`, a body or a whole
// response, and the calls it heard.
let stripe = (answer: (path: string) => unknown) => {
  let asked: {
    path: string
    on: string | null
    key: string | null
    body: Record<string, string>
  }[] = []
  let fetch = stub(
    globalThis,
    'fetch',
    (url: string | URL | Request, init?: RequestInit) => {
      let path = new URL(String(url)).pathname
      asked.push({
        path,
        on: new Headers(init?.headers).get('stripe-account'),
        key: new Headers(init?.headers).get('idempotency-key'),
        body: Object.fromEntries(new URLSearchParams(String(init?.body ?? ''))),
      })
      let said = answer(path)
      return Promise.resolve(
        said instanceof Response ? said : Response.json(said),
      )
    },
  )
  return { asked, [Symbol.dispose]: () => fetch.restore() }
}
let lent = shops({ key: 'sk' })
let heard = shopped({ key: 'sk' })

test('an account is the charge-merchants-directly model, in full', async () => {
  using s = stripe(() => ({ id: 'acct_1', details_submitted: true }))
  let seller = await lent.open({
    email: 'ada@example.com',
    tags: { space: 'e-space', slug: 'ada' },
  })
  equal(seller, { account: 'acct_1', ready: false, submitted: true })
  equal(s.asked[0].path, '/v1/accounts')
  // No `capabilities` (a dashboard of their own requests them, and
  // `transfers` is a destination charge's) and no `type` (the deprecated form
  // of these four).
  equal(s.asked[0].body, {
    // The merchant pays Stripe's processing fee out of their own charge.
    'controller[fees][payer]': 'account',
    // Stripe carries a lost dispute, not this platform.
    'controller[losses][payments]': 'stripe',
    // The merchant reads their money in their own Stripe dashboard — `full`,
    // not `express`: Stripe refuses the cut-down one beside a merchant who
    // pays their own fees.
    'controller[stripe_dashboard][type]': 'full',
    // Stripe collects the identity requirements. We never see one.
    'controller[requirement_collection]': 'stripe',
    email: 'ada@example.com',
    'metadata[space]': 'e-space',
    'metadata[slug]': 'ada',
  })
  // An address we do not have is left out rather than sent empty.
  await lent.open({ tags: {} })
  equal('email' in s.asked[1].body, false)
})

test('onboarding comes back to where it was asked from, both ways', async () => {
  using s = stripe(() => ({ url: 'https://connect.stripe.com/x' }))
  equal(
    await lent.onboarding('acct_1', 'https://back'),
    'https://connect.stripe.com/x',
  )
  equal(s.asked[0].path, '/v1/account_links')
  equal(s.asked[0].body, {
    account: 'acct_1',
    type: 'account_onboarding',
    return_url: 'https://back',
    refresh_url: 'https://back',
  })
})

let sale: Sale = {
  lines: [{ name: 'Everyday Tee (M)', cents: 2800, qty: 2 }],
  currency: 'usd',
  bps: 0,
  done: 'https://ada.yaks.app/shop/?ok',
  cancel: 'https://ada.yaks.app/shop/',
  tags: { space: 'e-space', app: 'shop' },
}

test('a checkout is a payment on the seller’s account, its tags on the payment too', async () => {
  using s = stripe(() => ({ url: 'https://checkout.stripe.com/c' }))
  equal(
    await lent.checkout('acct_1', { ...sale, email: 'ana@example.com' }),
    'https://checkout.stripe.com/c',
  )
  equal([s.asked[0].path, s.asked[0].on], ['/v1/checkout/sessions', 'acct_1'])
  // A refund arrives as a charge, which inherits the intent's metadata and
  // knows nothing of the session, so the tags ride both. With no fee there is
  // no `application_fee_amount` at all: Stripe requires a positive one.
  equal(s.asked[0].body, {
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': 'Everyday Tee (M)',
    'line_items[0][price_data][unit_amount]': '2800',
    'line_items[0][quantity]': '2',
    success_url: sale.done,
    cancel_url: sale.cancel,
    customer_email: 'ana@example.com',
    'metadata[space]': 'e-space',
    'metadata[app]': 'shop',
    'payment_intent_data[metadata][space]': 'e-space',
    'payment_intent_data[metadata][app]': 'shop',
  })
  // The fee rides the PaymentIntent, the only place a Checkout Session takes
  // one, and no address is no `customer_email`, so Stripe asks for one.
  await lent.checkout('acct_1', { ...sale, bps: 250 })
  equal(s.asked[1].body['payment_intent_data[application_fee_amount]'], '140')
  equal('customer_email' in s.asked[1].body, false)
})

// A subscription's payments are its invoices, so its fee is a share of each
// one and its tags ride the subscription every later event is about.
test('a renewing checkout is a subscription on the seller’s account, its fee a percent of each payment', async () => {
  using s = stripe(() => ({ url: 'https://checkout.stripe.com/s' }))
  let monthly: Sale = {
    ...sale,
    lines: [{ name: 'Coaching', cents: 500, qty: 1 }],
    per: 'month',
    bps: 250,
  }
  equal(
    await lent.checkout('acct_1', monthly),
    'https://checkout.stripe.com/s',
  )
  equal([s.asked[0].path, s.asked[0].on], ['/v1/checkout/sessions', 'acct_1'])
  equal(s.asked[0].body, {
    mode: 'subscription',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': 'Coaching',
    'line_items[0][price_data][unit_amount]': '500',
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][quantity]': '1',
    success_url: sale.done,
    cancel_url: sale.cancel,
    'metadata[space]': 'e-space',
    'metadata[app]': 'shop',
    'subscription_data[application_fee_percent]': '2.5',
    'subscription_data[metadata][space]': 'e-space',
    'subscription_data[metadata][app]': 'shop',
  })
  await lent.checkout('acct_1', { ...monthly, per: 'year', bps: 0 })
  let yearly = s.asked[1].body
  equal(yearly['line_items[0][price_data][recurring][interval]'], 'year')
  equal('subscription_data[application_fee_percent]' in yearly, false)
})

let NOW = Date.parse('2026-11-19T00:00:00Z') / 1000
let iso = (unix: number) => new Date(unix * 1000).toISOString()

// A subscription on the seller's account, as Stripe holds it: renewing,
// paid through a month from now, unless `over` says otherwise.
let sub = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  status: 'active',
  metadata: { app: 'coach' },
  items: {
    data: [{ current_period_start: NOW, current_period_end: NOW + 30 * 86400 }],
  },
  ...over,
})

test('a term is paid through its period, the period it failed, or when it ended', async () => {
  let until = async (over: Record<string, unknown>) => {
    using _ = stripe(() => sub(over))
    return (await lent.term('acct_1', 'sub_1'))!.until
  }
  let end = iso(NOW + 30 * 86400)
  equal(await until({}), end)
  // Stripe is still retrying the card: the period holds meanwhile.
  equal(await until({ status: 'past_due' }), end)
  // It gave up: paid up to the period that went unpaid.
  equal(await until({ status: 'unpaid' }), iso(NOW))
  // Ended, at its period's end or before it.
  equal(
    await until({ status: 'canceled', ended_at: NOW + 86400 }),
    iso(NOW + 86400),
  )
  // The first payment never came.
  equal(await until({ status: 'incomplete' }), null)
  equal(await until({ status: 'incomplete_expired' }), null)
})

test('a term is read on the seller’s account, and none is null', async () => {
  using s = stripe((path) =>
    path.endsWith('sub_1') ? sub() : Response.json(
      { error: { code: 'resource_missing', message: 'No such subscription' } },
      { status: 404 },
    )
  )
  equal(await lent.term('acct_1', 'sub_1'), {
    id: 'sub_1',
    until: iso(NOW + 30 * 86400),
    ending: null,
    tags: { app: 'coach' },
  })
  equal(s.asked[0], {
    path: '/v1/subscriptions/sub_1',
    on: 'acct_1',
    key: null,
    body: {},
  })
  equal(await lent.term('acct_1', 'sub_gone'), null)
})

test('a cancelled term ends with the period it paid for', async () => {
  using s = stripe(() => sub({ cancel_at_period_end: true }))
  let term = await lent.cancel('acct_1', 'sub_1')
  equal([s.asked[0].path, s.asked[0].on, s.asked[0].body], [
    '/v1/subscriptions/sub_1',
    'acct_1',
    { cancel_at_period_end: 'true' },
  ])
  equal([term.until, term.ending], Array(2).fill(iso(NOW + 30 * 86400)))
})

test('a checkout is read back by its id, with the subscription it started', async () => {
  using s = stripe((path) =>
    path.endsWith('cs_1')
      ? {
        id: 'cs_1',
        mode: 'subscription',
        payment_intent: null,
        subscription: 'sub_1',
        payment_status: 'paid',
        amount_total: 500,
        customer_details: { email: 'ana@example.com' },
        metadata: { app: 'coach' },
      }
      : Response.json({ error: { code: 'resource_missing' } }, { status: 404 })
  )
  equal(await lent.paid('acct_1', 'cs_1'), {
    paid: true,
    status: 'paid',
    checkout: 'cs_1',
    payment: '',
    subscription: 'sub_1',
    total: 500,
    email: 'ana@example.com',
    tags: { app: 'coach' },
  })
  equal([s.asked[0].path, s.asked[0].on], [
    '/v1/checkout/sessions/cs_1',
    'acct_1',
  ])
  equal(await lent.paid('acct_1', 'cs_gone'), null)
})

// Stripe substitutes the session id for that exact literal, and the host hands
// over an address `URL` wrote, braces percent-encoded: a string Stripe does
// not recognise, which would land the buyer on a page that never learns which
// order it is.
test('a checkout hands the buyer back with the session id filled in', async () => {
  using s = stripe(() => ({ url: 'https://checkout.stripe.com/c' }))
  let back = new URL('?ordered={CHECKOUT_SESSION_ID}', sale.done).href
  await lent.checkout('acct_1', { ...sale, done: back, cancel: back })
  let { success_url, cancel_url } = s.asked[0].body
  equal(
    [success_url, cancel_url],
    Array(2).fill('https://ada.yaks.app/shop/?ordered={CHECKOUT_SESSION_ID}'),
  )
})

let event = (type: string, object: Record<string, unknown>) =>
  heard({ type, account: 'acct_1', data: { object } })

test('an account event is the seller, an absent flag false', () => {
  equal(
    event('account.updated', { id: 'acct_1', charges_enabled: true }),
    {
      account: 'acct_1',
      about: 'seller',
      seller: { account: 'acct_1', ready: true, submitted: false },
    },
  )
  equal(event('account.application.deauthorized', {}), {
    account: 'acct_1',
    about: 'revoked',
  })
  equal(heard({ type: 'account.updated' }).account, '')
})

test('a completed session is the sale, paid only once the money is there', () => {
  let session = {
    id: 'cs_1',
    payment_intent: { id: 'pi_1' },
    payment_status: 'paid',
    amount_total: 6850,
    customer_email: 'prefilled@example.com',
    customer_details: { email: 'ana@example.com' },
    metadata: { app: 'shop' },
  }
  equal(event('checkout.session.completed', session), {
    account: 'acct_1',
    about: 'sale',
    sale: {
      paid: true,
      status: 'paid',
      checkout: 'cs_1',
      payment: 'pi_1',
      total: 6850,
      // What they typed on Stripe's page, not the prefill.
      email: 'ana@example.com',
      tags: { app: 'shop' },
    },
  })
  let processing = event('checkout.session.completed', {
    ...session,
    payment_status: 'unpaid',
    customer_details: {},
  })
  equal(
    processing.about == 'sale' &&
      [processing.sale.paid, processing.sale.email],
    [false, 'prefilled@example.com'],
  )
})

test('a refund or a dispute moves its payment', async () => {
  let moved = async (type: string, object: Record<string, unknown>) => {
    let heard = event(type, object)
    return heard.about == 'payment'
      ? [heard.to, await heard.payment()]
      : heard.about
  }
  let charge = { payment_intent: 'pi_1', metadata: { app: 'shop' } }
  let paid = { id: 'pi_1', tags: { app: 'shop' } }
  equal(await moved('charge.refunded', { ...charge, refunded: true }), [
    'refunded',
    paid,
  ])
  equal(await moved('charge.refunded', charge), ['partially_refunded', paid])
  // A dispute carries no metadata, so its charge is read back on the seller's
  // own account.
  using s = stripe(() => charge)
  equal(await moved('charge.dispute.created', { charge: 'ch_1' }), [
    'disputed',
    paid,
  ])
  equal(s.asked[0], {
    path: '/v1/charges/ch_1',
    on: 'acct_1',
    key: null,
    body: {},
  })
  equal(
    await moved('charge.dispute.closed', { charge: 'ch_1', status: 'lost' }),
    ['lost', paid],
  )
  equal(
    await moved('charge.dispute.closed', { charge: 'ch_1', status: 'won' }),
    ['restored', paid],
  )
  equal(await moved('charge.dispute.created', {}), ['disputed', null])
  equal(await moved('charge.dispute.updated', { charge: 'ch_1' }), 'other')
  equal(await moved('payout.paid', {}), 'other')
})

// Each is read again on the seller's account, whatever the event carried, so
// a renewal delivered after the cancellation that followed it still leaves
// the cancellation.
test('a subscription’s events and its paid invoices move its term', async () => {
  using s = stripe(() => sub())
  let term = async (type: string, object: Record<string, unknown>) => {
    let heard = event(type, object)
    return heard.about == 'term' ? (await heard.term())?.id : heard.about
  }
  let subscribed = { id: 'sub_1', status: 'canceled' }
  for (let at of ['created', 'updated', 'deleted']) {
    equal(await term(`customer.subscription.${at}`, subscribed), 'sub_1')
  }
  // An invoice names it under `parent` now, and at its top level before.
  let parent = { subscription_details: { subscription: 'sub_1' } }
  equal(await term('invoice.paid', { parent }), 'sub_1')
  equal(await term('invoice.paid', { subscription: 'sub_1' }), 'sub_1')
  equal(
    s.asked.map((a) => [a.path, a.on]),
    Array(5).fill(['/v1/subscriptions/sub_1', 'acct_1']),
  )
  // An invoice for no subscription is no term, and nothing is asked.
  equal(await term('invoice.paid', {}), undefined)
  equal(s.asked.length, 5)
  equal(await term('invoice.payment_failed', { parent }), 'other')
})

test('a physical checkout fixes its shipping address and charge, with retry identity', async () => {
  using s = stripe(() => ({ url: 'https://checkout.stripe.com/physical' }))
  await lent.checkout('acct_1', {
    ...sale,
    key: 'quote_1',
    expires: '2026-11-11T00:00:00Z',
    destination: {
      name: 'Ana',
      address: {
        line1: '1 Main St',
        city: 'Austin',
        postal_code: '78701',
        country: 'US',
      },
    },
    shipping: { name: 'Ground', cents: 500 },
  })
  let body = s.asked[0].body
  equal(s.asked[0].key, 'quote_1')
  equal(body['payment_intent_data[shipping][address][line1]'], '1 Main St')
  equal(
    body['shipping_options[0][shipping_rate_data][fixed_amount][amount]'],
    '500',
  )
  equal(body.expires_at, String(Date.parse('2026-11-11T00:00:00Z') / 1000))
  equal('shipping_address_collection[allowed_countries][0]' in body, false)
})

test('a merchant refund keeps its retry key and reverses its application fee proportionally', async () => {
  let calls = 0
  using s = stripe(() =>
    ++calls == 1 ? { data: [], has_more: false } : ({
      id: 're_1',
      payment_intent: 'pi_1',
      amount: 500,
      status: 'succeeded',
    })
  )
  let refund = await lent.refund('acct_1', {
    key: 'request_1',
    payment: 'pi_1',
    amount: 500,
    fee: true,
    tags: { app: 'books' },
  })
  equal(s.asked[1].key, 'request_1')
  equal([refund.id, refund.status, refund.amount], ['re_1', 'succeeded', 500])
  equal([s.asked[1].path, s.asked[1].on], ['/v1/refunds', 'acct_1'])
  equal(s.asked[1].body, {
    payment_intent: 'pi_1',
    amount: '500',
    refund_application_fee: 'true',
    'metadata[app]': 'books',
    'metadata[request]': 'request_1',
  })
})

test('a dashboard refund returns only the application fee still owed, including a retry', async () => {
  let refunded = 0
  using s = stripe((path) => {
    if (path.endsWith('/refunds')) {
      refunded = 25
      return { id: 'fr_1' }
    }
    return { id: 'fee_1', amount: 100, amount_refunded: refunded }
  })
  await lent.refundFee('fee_1', 250, 1000)
  await lent.refundFee('fee_1', 250, 1000)
  equal(s.asked.filter((a) => a.path.endsWith('/refunds')).map((a) => a.body), [
    { amount: '25' },
  ])
  equal(s.asked[1].on, null)
})

test('refund recovery finds the earlier refund after the provider retry key expired', async () => {
  using s = stripe(() => ({
    data: [{
      id: 're_old',
      payment_intent: 'pi_1',
      amount: 500,
      status: 'succeeded',
      metadata: { request: 'request_1' },
    }],
    has_more: false,
  }))
  let refund = await lent.refund('acct_1', {
    key: 'request_1',
    payment: 'pi_1',
    amount: 500,
    tags: {},
  })
  equal(refund.id, 're_old')
  equal(s.asked.length, 1)
  equal(s.asked[0].key, null)
})
