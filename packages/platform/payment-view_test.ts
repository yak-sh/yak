import { equal, test } from '@yaks/testing'
import { beyond } from './standing.ts'
import { PRICE, PRO_GRANT, YEARLY } from './plans.ts'
import type { PlanCard, Selling } from './payment-rows.ts'
import {
  page,
  paymentRows,
  paymentShown,
  said,
  SOLD,
} from './payment_fixture_test.ts'

let cost = (tier: 'plus' | 'pro', per: 'month' | 'year') =>
  `$${(per == 'year' ? YEARLY : PRICE)[tier]} a ${per}`

let plan = (over: Partial<PlanCard>): PlanCard => ({
  tier: 'free',
  ends: '',
  known: false,
  sold: SOLD,
  ...over,
})

let has = (text: string, ...parts: string[]) => {
  for (let part of parts) equal(text.includes(part), true, part)
}

let billing = (over: Partial<PlanCard>) =>
  page(paymentShown(), paymentRows({ plan: plan(over) }))

test('a paid plan says unlimited apps, and offers nothing more to buy', () => {
  for (let tier of ['plus', 'pro'] as const) {
    let at = billing({ tier, known: true })
    has(at.textContent!, 'Unlimited apps')
    equal(at.textContent!.includes('null apps'), false)
    equal(!!at.querySelector('[data-door="checkout"]'), false, tier)
    equal(!!at.querySelector('[data-door="portal"]'), true, tier)
  }
})

test('the plan card says what the Pro plan gives beyond the Personal plan', () => {
  let gives = `The Pro plan gives ${beyond()}, and email support. Taking ` +
    `it adds $${PRO_GRANT} of building credit once.`
  has(said({}, { plan: plan({ known: true }) }), gives)
  has(
    said({}, { plan: plan({ tier: 'plus', known: true }) }),
    `${gives} Switch to it from Manage billing.`,
  )
  let pro = said({}, { plan: plan({ tier: 'pro', known: true }) })
  equal(pro.includes('The Pro plan gives'), false)
  has(pro, `unlimited visitors, ${beyond()}, and email support`)
})

test('a space on the Personal plan free says through when, and offers to keep it after', () => {
  let text = said({}, {
    plan: plan({ tier: 'plus', free: '2026-12-05T15:00:00.000Z' }),
  })
  has(
    text,
    'free through Dec 5th, 2026',
    ...SOLD.plus.map((per) =>
      `Keep the Personal plan for ada — ${cost('plus', per)}`
    ),
  )
})

test('the plan card offers each plan by the month and the year only where it is on sale', () => {
  let monthly = billing({ sold: { plus: ['month'], pro: [] } })
  has(
    monthly.textContent!,
    `Get the Personal plan for ada — ${cost('plus', 'month')}`,
    'The Pro plan is not on sale here yet',
  )
  equal(!!monthly.querySelector('[data-per="year"]'), false)
  equal(!!monthly.querySelector('[data-plan="pro"]'), false)
  let all = billing({})
  for (let tier of ['plus', 'pro'] as const) {
    for (let per of SOLD[tier]) {
      let b = all.querySelector(`[data-plan="${tier}"][data-per="${per}"]`)
      equal(
        b?.textContent,
        `Get the ${tier == 'pro' ? 'Pro' : 'Personal'} plan for ada — ${
          cost(tier, per)
        }`,
      )
    }
  }
  equal(all.textContent!.includes('not on sale'), false)
  equal(
    !!billing({ sold: { plus: [], pro: [] } }).querySelector(
      '[data-door="checkout"]',
    ),
    false,
  )
})

test('a free space is offered the yearly Pro plan by invoice, where it may be', () => {
  let sold = { plus: ['month'], pro: ['year'] } as PlanCard['sold']
  let offered = billing({ sold, invoice: 60 })
  has(
    offered.textContent!,
    'Pay by invoice instead',
    '$490 a year, due 60 days after each invoice',
  )
  equal(!!offered.querySelector('form[data-invoice] [name=email]'), true)
  equal(billing({ sold }).textContent!.includes('Pay by invoice'), false)
  equal(
    billing({ sold, tier: 'pro', known: true, invoice: 60 }).textContent!
      .includes('Pay by invoice'),
    false,
    'not to a space already paying',
  )
  let waiting = billing({ sold, known: true, invoice: 60, awaiting: true })
    .textContent!
  has(waiting, 'The Pro plan starts when its invoice is paid')
  equal(
    ['Pay by invoice', 'Get the Pro plan'].some((s) => waiting.includes(s)),
    false,
    'nothing more to buy while its invoice waits',
  )
})

test('billing shows each allowance and whom it bills', () => {
  let GB = 1024 ** 3
  let limits = {
    apps: { used: 3, limit: 5 },
    requests: { used: 41_000, limit: 50_000 },
    bytes: { used: 0, limit: GB },
    files: { used: GB, limit: GB },
    emails: { used: 12, limit: 100 },
    seconds: { used: 90, limit: 3_600 },
  }
  let month = (read: string | null = '2026-11-03T14:00:00.000Z') => ({
    limits,
    budget: { spent: 0.05, limit: 0.2 },
    read,
  })
  let view = { space: { eid: 'e', slug: 'ada', title: 'Ada’s kitchen' } }
  let one = said(view, {
    plan: plan({ provider: 'Paybox', sold: { plus: ['month'], pro: [] } }),
    allowances: month(),
  })
  has(
    one,
    `Get the Personal plan for Ada’s kitchen — ${cost('plus', 'month')}`,
    'Nothing is billed.',
    'last read at 14:00 UTC',
    '3 of 5',
    '41,000 of 50,000',
    '12 of 100',
    '25% used',
    // Four fifths of request units is near; all of the files is at the limit.
    'Near the limit',
    'At the limit',
  )
  has(
    said(view, { allowances: month(null) }),
    'None counted yet this month, of 50,000',
  )
  let paying = plan({ tier: 'plus', known: true, provider: 'Paybox' })
  has(
    said(view, {
      plan: paying,
      payer: { email: 'ada@x.test', name: 'Ada' },
    }),
    'Billed to ada@x.test (Ada) through Paybox',
  )
  has(said(view, { plan: paying }), 'Billed through Paybox.')
})

let shop = (over: Partial<Selling> = {}): Selling => ({
  state: 'none',
  house: false,
  linkable: false,
  provider: 'Paybox',
  fee: 0,
  ...over,
})
let selling = (sell?: Selling, tier: PlanCard['tier'] = 'plus') =>
  page(
    paymentShown({ view: 'selling' }),
    paymentRows({ plan: plan({ tier }), selling: sell }),
  )

test('selling names the provider it sells through, and its buttons say what they do', () => {
  let none = selling(shop())
  has(none.textContent!, 'Create a Paybox account')
  equal(
    none.querySelector('[data-door="start"]')?.textContent,
    'Create a Paybox account',
  )
  let ready = selling(shop({ state: 'ready', linkable: true }))
  equal(
    ready.querySelector('[data-sell-stop]')?.textContent,
    'Disconnect Paybox',
  )
  equal(!!ready.querySelector('[data-door="link"]'), true)
  equal(
    selling(shop({ state: 'setup', linkable: true }))
      .querySelector('[data-door="link"]')?.textContent,
    'Connect it instead',
  )
  equal(
    selling(shop(), 'free').querySelector('[data-door="checkout"]')
      ?.textContent,
    `Subscribe — $${PRICE.plus} a month`,
  )
  has(selling().textContent!, 'Selling is not available here yet.')
})

test('selling names the apps that may sell, a few and how many more', () => {
  let apps = ['Shop', 'Books', 'Cards', 'Prints', 'Pins'].map((title, n) => ({
    eid: `a${n}`,
    slug: title.toLowerCase(),
    title,
  }))
  has(
    page(
      paymentShown({ view: 'selling' }),
      paymentRows({ plan: plan({ tier: 'plus' }), selling: shop(), apps }),
    ).textContent!,
    'Every app in this space can take payments: Shop, Books, Cards, and 2 more.',
  )
})

test('selling spells out every cost and works a $20 sale through them', () => {
  let costs = {
    card: { bps: 290, cents: 30 },
    abroad: 150,
    dispute: 1500,
    refunded: false,
    payout: { days: 2, first: 7 },
    country: 'US',
    pricing: 'https://paybox.test/pricing',
  }
  let text = (over: Partial<Selling>, tier: PlanCard['tier'] = 'plus') =>
    selling(shop({ costs, ...over }), tier).textContent!
  has(
    text({ fee: 100 }),
    'Paybox: 2.9% + 30¢ a payment',
    'adds 1.5%',
    'yaks.app: 1% of each sale',
    'about 2 days after each sale',
    'about 7 days after your first sale',
    'Paybox keeps its fee on a refunded payment. yaks.app gives its fee back.',
    'Disputes: $15',
    'Any sales tax you owe is yours to pay.',
    '−$0.88',
    '−$0.20',
    '$18.92',
  )
  has(text({ fee: 0 }), 'yaks.app: nothing per sale', '$19.12')
  has(text({ fee: 100 }, 'free'), 'The Personal plan: $12 a month')
  has(
    text({ state: 'ready', house: true, fee: 100 }),
    'as the house',
    'yaks.app: nothing per sale',
  )
})
