// The paid tier at its seams (billing.ts, T-33125): the plan derived from one
// subscription, which is the whole of the idempotency and ordering story, so it
// is tested here rather than only through the door. Stripe's signature is
// @yaks/hook's (signed_test.ts).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import {
  elsewhere,
  freeThrough,
  lost,
  moved,
  periodEnd,
  planCard,
  planOf,
  priceFor,
  stale,
  type Sub,
  trialFor,
  wanted,
} from './billing.ts'
import type { Env } from './env.ts'
import { type Plan, tierOf } from './directory.ts'

// --- the plan, derived --------------------------------------------------

let AT = '2026-09-03T12:00:00.000Z'
let LATER = '2026-09-03T13:00:00.000Z'
let PERIOD = 1_790_000_000

let sub = (over: Partial<Sub> = {}): Sub => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  metadata: { space: 'space-eid' },
  items: { data: [{ current_period_end: PERIOD }] },
  ...over,
})

test('the period end is read off the item, and off the subscription', () => {
  // Where it lives since API 2025-03-31.basil...
  assertEquals(periodEnd(sub()), PERIOD)
  // ...and where it lived before, which an older api_version still sends.
  assertEquals(periodEnd({ current_period_end: 42, items: { data: [] } }), 42)
  assertEquals(periodEnd({}), null)
})

test('a paying subscription is plus, and the rest are free', () => {
  for (let status of ['active', 'trialing', 'past_due']) {
    assertEquals(planOf(sub({ status }), AT).tier, 'plus', status)
  }
  for (
    let status of [
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused',
    ]
  ) {
    assertEquals(planOf(sub({ status }), AT).tier, 'free', status)
  }
})

// --- the Organization plan, read off the price (D-134567) ----------------

let ORG = ['price_org_month', 'price_org_year']
let priced = (price: unknown, over: Partial<Sub> = {}) =>
  sub({
    items: { data: [{ current_period_end: PERIOD, price } as never] },
    ...over,
  })

test('a subscription to an Organization price is the Organization plan', () => {
  for (let price of [...ORG, { id: ORG[1] }]) {
    assertEquals(planOf(priced(price), AT, ORG).tier, 'organization')
  }
  assertEquals(
    planOf(priced(ORG[0], { status: 'canceled' }), AT, ORG).tier,
    'free',
  )
})

test('every other paying subscription stays on the Plus plan', () => {
  // A Plus price, no price at all, and a deployment with no Organization
  // prices yet: each reads exactly as it did before the plan existed.
  assertEquals(planOf(priced('price_plus'), AT, ORG).tier, 'plus')
  assertEquals(planOf(sub(), AT, ORG).tier, 'plus')
  assertEquals(planOf(priced(ORG[0]), AT).tier, 'plus')
  assertEquals(planOf(priced(ORG[0]), AT, []).tier, 'plus')
})

let ENV = {
  STRIPE_KEY: 'sk',
  STRIPE_PRICE: 'price_plus',
  STRIPE_PRICE_ORGANIZATION: ORG[0],
  STRIPE_PRICE_ORGANIZATION_YEAR: ORG[1],
} as Env
let form = (o: Record<string, string>) => {
  let f = new FormData()
  for (let [k, v] of Object.entries(o)) f.set(k, v)
  return f
}

test('a checkout form names the price it buys', () => {
  let price = (o: Record<string, string>, env = ENV) =>
    priceFor(env, wanted(form(o)))
  assertEquals(price({}), 'price_plus')
  assertEquals(priceFor(ENV, wanted(null)), 'price_plus')
  assertEquals(price({ plan: 'organization' }), ORG[0])
  assertEquals(price({ plan: 'organization', per: 'year' }), ORG[1])
  assertEquals(price({ per: 'year' }), undefined)
  assertEquals(
    price({ plan: 'organization' }, { STRIPE_KEY: 'sk' } as Env),
    undefined,
  )
})

test('the plan card offers the Organization plan by what is priced', () => {
  let space = { tier: null, plan: null } as never
  assertEquals(planCard(ENV, space).organization, ['month', 'year'])
  assertEquals(
    planCard({ ...ENV, STRIPE_KEY: undefined }, space).organization,
    [],
  )
  assertEquals(
    planCard({ ...ENV, STRIPE_PRICE_ORGANIZATION_YEAR: undefined }, space)
      .organization,
    ['month'],
  )
  assertEquals(planCard(ENV, space).tier, 'free')
})

// --- the Plus plan given free ---------------------------------------------

let NOW = Date.parse('2026-11-05T15:00:00.000Z')
let COMP = '2026-12-05T15:00:00.000Z'
let paying = planOf(sub(), AT)

test('a space given the Plus plan free is on it through that day, unless Stripe bills it', () => {
  assertEquals(tierOf('ana', null, COMP, NOW), 'plus')
  assertEquals(tierOf('ana', 'free', COMP, Date.parse(COMP) + 1), 'free')
  assertEquals(tierOf('ana', 'organization', COMP, NOW), 'organization')
  assertEquals(freeThrough({ plan: null, comped: COMP }, NOW), COMP)
  assertEquals(
    freeThrough({ plan: null, comped: COMP }, Date.parse(COMP)),
    null,
  )
  assertEquals(freeThrough({ plan: paying, comped: COMP }, NOW), null)
  assertEquals(freeThrough({ plan: null }, NOW), null)
})

test('subscribing while free starts with a trial as long as the free time, and two days at least', () => {
  assertEquals(trialFor(COMP, NOW), { trial_end: Date.parse(COMP) / 1000 })
  assertEquals(trialFor('2026-11-06T15:00:00.000Z', NOW), {
    trial_end: (NOW + 49 * 3600_000) / 1000,
  })
  assertEquals(trialFor(null, NOW), {})
})

test('cancelled but paid through says both, in one row', () => {
  let renewing = planOf(sub(), AT)
  assertEquals(renewing.until, new Date(PERIOD * 1000).toISOString())
  assertEquals(renewing.ending, null, 'a renewing plan is not ending')

  let leaving = planOf(sub({ cancel_at_period_end: true }), AT)
  assertEquals(leaving.tier, 'plus', 'still paid for')
  assertEquals(leaving.ending, renewing.until, 'and it runs out then')

  let over = planOf(sub({ status: 'canceled', ended_at: 1_789_000_000 }), AT)
  assertEquals(over.tier, 'free')
  assertEquals(over.ending, new Date(1_789_000_000 * 1000).toISOString())
})

// --- at-least-once, out of order ----------------------------------------

let row = (over: Partial<Plan> = {}): Plan => ({
  ...planOf(sub(), AT),
  ...over,
})

test('the same event twice writes nothing the second time', () => {
  let now = row()
  let again = planOf(sub(), AT)
  assert(!stale(now, again), 'a duplicate is not stale, it is simply the same')
  assertEquals(moved(now, again), {}, 'and there is nothing to write')
})

test('deleted before an older updated does not revive the plan', () => {
  // The delete lands first, whatever its clock says...
  let dead = planOf(
    sub({ status: 'canceled', ended_at: 1_789_000_000 }),
    AT,
  )
  assertEquals(dead.tier, 'free')
  // ...and the update that was written earlier but arrived later is refused,
  // by the rule that an ended subscription is never revived — note its `at` is
  // LATER, so a clock comparison alone would have let it through.
  let late = planOf(sub({ status: 'active' }), LATER)
  assert(stale(dead, late), 'a cancelled plan does not come back')
})

test('an event older than the row is dropped', () => {
  let now = row({ at: LATER, status: 'active' })
  assert(stale(now, planOf(sub({ status: 'past_due' }), AT)))
  assert(
    !stale(now, planOf(sub({ status: 'past_due' }), LATER)),
    'the same moment stands',
  )
})

test('a new subscription after a cancelled one is not refused', () => {
  let dead = planOf(sub({ status: 'canceled' }), AT)
  let fresh = planOf(sub({ id: 'sub_2', status: 'active' }), LATER)
  assert(!stale(dead, fresh), 'a different subscription is a new sentence')
  assertEquals(moved(dead, fresh).tier, 'plus')
})

test('a first plan is never stale', () => {
  assert(!stale(null, planOf(sub(), AT)))
  assertEquals(Object.keys(moved(null, planOf(sub(), AT))).length, 7)
})

// --- whose purchase ------------------------------------------------------

test('another apex is elsewhere, and ours or none is not', () => {
  let bought = (apex?: string) => ({ metadata: apex ? { apex } : {} })
  assert(elsewhere(bought('yaks.app'), 'yaks.fyi'))
  assert(!elsewhere(bought('yaks.fyi'), 'yaks.fyi'))
  assert(!elsewhere(bought(), 'yaks.fyi'))
  // An invoice carries its subscription's metadata under `parent`.
  let invoice = {
    metadata: {},
    parent: { subscription_details: { metadata: { apex: 'yaks.app' } } },
  }
  assert(elsewhere(invoice, 'yaks.fyi'))
  assert(!elsewhere(invoice, 'yaks.app'))
})

test('a subscription no space holds is lost in live mode, and in the sandbox only when it names our apex', () => {
  let bought = (apex?: string) =>
    sub({ metadata: { space: 'space-eid', ...apex ? { apex } : {} } })
  assert(lost(bought(), true, 'yaks.fyi'))
  assert(lost(bought(), undefined, 'yaks.fyi'))
  assert(lost(bought('yaks.fyi'), false, 'yaks.fyi'))
  // A probe's, bought in the shared sandbox before the apex was stamped.
  assert(!lost(bought(), false, 'yaks.fyi'))
})
