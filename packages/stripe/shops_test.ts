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

// Stripe, answering each call with `answer(path)`, and the calls it heard.
let stripe = (answer: (path: string) => unknown) => {
  let asked: {
    path: string
    on: string | null
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
        body: Object.fromEntries(new URLSearchParams(String(init?.body ?? ''))),
      })
      return Promise.resolve(Response.json(answer(path)))
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
  fee: 0,
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
  await lent.checkout('acct_1', { ...sale, fee: 250 })
  equal(s.asked[1].body['payment_intent_data[application_fee_amount]'], '250')
  equal('customer_email' in s.asked[1].body, false)
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
  equal(s.asked[0], { path: '/v1/charges/ch_1', on: 'acct_1', body: {} })
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
