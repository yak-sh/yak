// Stripe's plans (plans.ts): a subscription read into the host's words, and
// what each call puts on the wire, against a Stripe stood in by `fetch`.
import { clock, equal, ok, test } from '@yaks/testing'
import { stub } from '@std/testing/mock'
import type { Bought, Changed } from '@yaks/host/payments'
import {
  changed,
  ONCE_TAX,
  periodEnd,
  plans,
  read,
  type Sub,
  trialFor,
} from './plans.ts'

let PERIOD = 1_790_000_000
let PRO = ['price_pro_month', 'price_pro_year']
let PRICES = {
  plus: { month: 'price_plus' },
  pro: { month: PRO[0], year: PRO[1] },
}
let sub = (over: Partial<Sub> = {}): Sub => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  metadata: { space: 'space-eid' },
  items: { data: [{ current_period_end: PERIOD }] },
  ...over,
})
let priced = (price: unknown, over: Partial<Sub> = {}) =>
  sub({
    items: { data: [{ current_period_end: PERIOD, price } as never] },
    ...over,
  })
let NOW = Date.parse('2026-11-05T15:00:00.000Z')
let at = (unix: number) => new Date(unix * 1000).toISOString()

// Stripe, answering each call with `answer(path)`, and the calls it heard.
let stripe = (answer: (path: string) => Response) => {
  let asked: { path: string; method: string; body: URLSearchParams }[] = []
  let fetch = stub(
    globalThis,
    'fetch',
    (url: string | URL | Request, init?: RequestInit) => {
      let path = new URL(String(url)).pathname
      asked.push({
        path,
        method: init?.method ?? 'GET',
        body: new URLSearchParams(String(init?.body ?? '')),
      })
      return Promise.resolve(answer(path))
    },
  )
  return { asked, [Symbol.dispose]: () => fetch.restore() }
}
let OPTIONS = { key: 'sk', clock: clock(NOW), prices: PRICES }
let lent = plans(OPTIONS)
let heard = (event: unknown) => changed(OPTIONS)(event) as Changed
let bought = (event: unknown) => changed(OPTIONS)(event) as Bought

test('the period end is read off the item, and off the subscription', () => {
  equal(periodEnd(sub()), PERIOD)
  equal(periodEnd({ current_period_end: 42, items: { data: [] } }), 42)
  equal(periodEnd({}), null)
})

test('a paying status keeps the plan, and the rest do not', () => {
  let { standing } = lent
  equal(
    ['active', 'trialing', 'past_due'].map(standing),
    ['paying', 'paying', 'owing'],
  )
  equal(
    ['unpaid', 'incomplete', 'paused', 'canceled', 'incomplete_expired']
      .map(standing),
    ['lapsed', 'lapsed', 'lapsed', 'ended', 'ended'],
  )
})

test('the tier is read off the price, the first tier where none is listed', () => {
  for (let price of [...PRO, { id: PRO[1] }]) {
    equal(read(priced(price), PRICES).tier, 'pro')
  }
  equal(read(priced('price_plus'), PRICES).tier, 'plus')
  equal(read(priced('price_old'), PRICES).tier, 'plus')
  equal(read(sub(), PRICES).tier, 'plus')
  equal(read(priced(PRO[0]), { plus: {} }).tier, 'plus')
})

test('cancelled but paid through says both', () => {
  let renewing = read(sub())
  equal([renewing.until, renewing.ending], [at(PERIOD), null])
  equal(read(sub({ cancel_at_period_end: true })).ending, at(PERIOD))
  let over = read(sub({ status: 'canceled', ended_at: 1_789_000_000 }))
  equal(over.ending, at(1_789_000_000))
  equal(
    [over.payer, over.id, over.tags],
    ['cus_1', 'sub_1', { space: 'space-eid' }],
  )
})

test('a tier is on sale where its price is, and nothing is without a key', () => {
  equal(
    [
      lent.offers('plus', 'month'),
      lent.offers('plus', 'year'),
      lent.offers('pro', 'year'),
    ],
    [true, false, true],
  )
  let unkeyed = plans({ prices: PRICES })
  equal([unkeyed.on(), unkeyed.offers('plus', 'month')], [false, false])
})

test('subscribing while free starts with a trial as long as the free time, and two days at least', () => {
  equal(trialFor('2026-12-05T15:00:00.000Z', NOW), {
    trial_end: Date.parse('2026-12-05T15:00:00.000Z') / 1000,
  })
  equal(trialFor('2026-11-06T15:00:00.000Z', NOW), {
    trial_end: (NOW + 49 * 3600_000) / 1000,
  })
  equal(trialFor(null, NOW), {})
})

test('checkout is a Managed Payments subscription carrying the tags and the trial', async () => {
  using s = stripe(() => Response.json({ url: 'https://checkout' }))
  let url = await lent.checkout({
    payer: 'cus_1',
    tier: 'pro',
    per: 'year',
    done: 'https://yes',
    cancel: 'https://no',
    reference: 'space-eid',
    tags: { space: 'space-eid', apex: 'yaks.fyi' },
    trial: '2026-12-05T15:00:00.000Z',
  })
  equal(url, 'https://checkout')
  let body = Object.fromEntries(s.asked[0].body)
  equal(s.asked[0].path, '/v1/checkout/sessions')
  equal(body, {
    mode: 'subscription',
    customer: 'cus_1',
    'line_items[0][price]': PRO[1],
    'line_items[0][quantity]': '1',
    success_url: 'https://yes',
    cancel_url: 'https://no',
    client_reference_id: 'space-eid',
    'metadata[space]': 'space-eid',
    'metadata[apex]': 'yaks.fyi',
    'subscription_data[metadata][space]': 'space-eid',
    'subscription_data[metadata][apex]': 'yaks.fyi',
    'subscription_data[trial_end]': String(
      Date.parse('2026-12-05T15:00:00.000Z') / 1000,
    ),
    'managed_payments[enabled]': 'true',
    allow_promotion_codes: 'true',
  })
})

test('a one-off checkout is Managed Payments in payment mode, its price inline and tax included', async () => {
  using s = stripe(() => Response.json({ url: 'https://checkout' }))
  let url = await lent.once({
    payer: 'cus_1',
    name: '$10 of AI credit for ada',
    cents: 1000,
    currency: 'USD',
    done: 'https://yes',
    cancel: 'https://no',
    reference: 'space-eid',
    tags: { space: 'space-eid', credit: '10' },
  })
  equal(url, 'https://checkout')
  equal(s.asked[0].path, '/v1/checkout/sessions')
  equal(Object.fromEntries(s.asked[0].body), {
    mode: 'payment',
    customer: 'cus_1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': '1000',
    'line_items[0][price_data][tax_behavior]': 'inclusive',
    'line_items[0][price_data][product_data][name]': '$10 of AI credit for ada',
    'line_items[0][price_data][product_data][tax_code]': ONCE_TAX,
    'line_items[0][quantity]': '1',
    success_url: 'https://yes',
    cancel_url: 'https://no',
    client_reference_id: 'space-eid',
    'metadata[space]': 'space-eid',
    'metadata[credit]': '10',
    'payment_intent_data[metadata][space]': 'space-eid',
    'payment_intent_data[metadata][credit]': '10',
    'managed_payments[enabled]': 'true',
  })
})

test('a checkout in payment mode is a purchase, paid once its money is there', () => {
  let session = (type: string, payment_status: string) =>
    bought({
      type,
      created: PERIOD,
      livemode: false,
      data: {
        object: {
          id: 'cs_1',
          mode: 'payment',
          payment_status,
          client_reference_id: 'space-eid',
          metadata: { space: 'space-eid', credit: '10' },
        },
      },
    })
  equal(session('checkout.session.completed', 'paid'), {
    about: 'purchase',
    at: at(PERIOD),
    live: false,
    checkout: 'cs_1',
    paid: true,
    tags: { space: 'space-eid', credit: '10' },
    reference: 'space-eid',
  })
  equal(session('checkout.session.completed', 'unpaid').paid, false)
  equal(
    session('checkout.session.async_payment_succeeded', 'paid').paid,
    true,
  )
  // A subscription's checkout is still about its subscription.
  equal(
    heard({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription' } },
    }).about,
    'subscription',
  )
})

test('a subscription Stripe cannot find reads as none', async () => {
  using _ = stripe(() =>
    Response.json({
      error: { message: 'No such subscription', code: 'resource_missing' },
    }, { status: 404 })
  )
  equal(await lent.subscription('sub_gone'), null)
})

test('a deleted customer is billed to nobody', async () => {
  using _ = stripe(() => Response.json({ id: 'cus_1', deleted: true }))
  equal(await lent.billed('cus_1'), null)
})

test('a charge is moved later once, and never earlier', async () => {
  let ends = PERIOD
  using s = stripe(() => Response.json(sub({ current_period_end: ends })))
  await lent.postpone('sub_1', at(PERIOD + 86400))
  await lent.postpone('sub_1', at(PERIOD - 86400))
  let posts = s.asked.filter((a) => a.method == 'POST')
  equal(posts.length, 1)
  equal(posts[0].body.get('trial_end'), String(PERIOD + 86400))
  equal(posts[0].body.get('proration_behavior'), 'none')
})

test('an event reads its tags, its subscription and whether it moved money', async () => {
  let updated = heard({
    type: 'customer.subscription.updated',
    created: PERIOD,
    data: { object: sub({ metadata: { space: 's', apex: 'yaks.app' } }) },
  })
  equal([updated.at, updated.live, updated.tags.apex], [
    at(PERIOD),
    true,
    'yaks.app',
  ])
  equal((await updated.subscription())?.id, 'sub_1')
  // An invoice carries its subscription's tags under `parent`, and names it.
  using s = stripe(() => Response.json(sub({ id: 'sub_2' })))
  let invoice = heard({
    type: 'invoice.paid',
    livemode: false,
    data: {
      object: {
        metadata: {},
        parent: {
          subscription_details: {
            subscription: 'sub_2',
            metadata: { apex: 'yaks.fyi' },
          },
        },
      },
    },
  })
  equal([invoice.live, invoice.tags.apex], [false, 'yaks.fyi'])
  equal((await invoice.subscription())?.id, 'sub_2')
  equal(s.asked.map((a) => a.path), ['/v1/subscriptions/sub_2'])
  let none = heard({ type: 'checkout.session.completed', data: {} })
  ok((await none.subscription()) === undefined)
})
