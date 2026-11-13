// The paid tier at its seams (billing.ts, T-33125): the plan derived from one
// subscription, which is the whole of the idempotency and ordering story, so it
// is tested here rather than only through the door, over the provider
// config.ts lends (payments.ts) with the Worker's prices. How the provider
// reads its own wire is its package's (@yaks/stripe plans_test.ts), and its
// webhook signature @yaks/hook's (signed_test.ts).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Subscription } from '@yaks/host/payments'
import {
  badTo,
  bought,
  DUE,
  elsewhere,
  freeThrough,
  lost,
  moved,
  planCard,
  planOf,
  stale,
  wanted,
} from './billing.ts'
import { plans } from './payments.ts'
import { type Plan, tierOf } from './directory.ts'

// --- the plan, derived --------------------------------------------------

let AT = '2026-09-03T12:00:00.000Z'
let LATER = '2026-09-03T13:00:00.000Z'
let UNTIL = '2026-09-21T14:13:20.000Z'
let PRO = ['price_pro_month', 'price_pro_year']
let ENV = {
  STRIPE_KEY: 'sk',
  STRIPE_PRICE: 'price_plus',
  STRIPE_PRICE_PRO: PRO[0],
  STRIPE_PRICE_PRO_YEAR: PRO[1],
}
let lent = await plans(ENV)
let { standing } = lent

let sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: 'sub_1',
  payer: 'cus_1',
  tier: 'plus',
  status: 'active',
  until: UNTIL,
  ending: null,
  tags: { space: 'space-eid' },
  ...over,
})
let plan = (over: Partial<Subscription> = {}, at = AT) =>
  planOf(sub(over), at, standing)

test('checkout keeps the plan and cadence requested by current and kept pages', () => {
  for (let name of ['pro', 'organization']) {
    let form = new FormData()
    form.set('plan', name)
    form.set('per', 'year')
    assertEquals(wanted(form), { tier: 'pro', per: 'year' })
    form.delete('per')
    assertEquals(wanted(form), { tier: 'pro', per: 'month' })
  }
  assertEquals(wanted(null), { tier: 'plus', per: 'month' })
})

test('a paying subscription keeps the tier its price buys, and the rest are free', () => {
  for (let status of ['active', 'trialing', 'past_due']) {
    assertEquals(plan({ status, tier: 'pro' }).tier, 'pro')
  }
  for (let status of ['canceled', 'unpaid', 'incomplete', 'paused']) {
    assertEquals(plan({ status }).tier, 'free', status)
  }
  assertEquals(plan(), {
    tier: 'plus',
    customer: 'cus_1',
    subscription: 'sub_1',
    status: 'active',
    until: UNTIL,
    ending: null,
    at: AT,
  })
})

test('the plan card offers the Pro plan by what is priced', async () => {
  let space = { tier: null, plan: null } as never
  let card = async (env: Record<string, string | undefined>) =>
    planCard(await plans(env), space).pro
  assertEquals(planCard(lent, space).pro, ['month', 'year'])
  assertEquals(await card({ ...ENV, STRIPE_KEY: undefined }), [])
  assertEquals(
    await card({ ...ENV, STRIPE_PRICE_PRO_YEAR: undefined }),
    ['month'],
  )
  assertEquals(planCard(lent, space).tier, 'free')
})

test('the yearly Pro plan may be paid by invoice wherever it is priced', async () => {
  let space = { tier: null, plan: null } as never
  assertEquals(planCard(lent, space).invoice, DUE)
  let unpriced = await plans({ ...ENV, STRIPE_PRICE_PRO_YEAR: undefined })
  assertEquals(planCard(unpriced, space).invoice, undefined)
})

test('an invoice goes to an email address, made out to a name of reasonable length', () => {
  let to = (email: string, name = '') => badTo({ email, name })
  assertEquals(to('clerk@township.test', 'Hollow Township'), null)
  assertEquals(to('clerk@township.test'), null)
  for (let bad of ['', 'clerk', 'clerk@', 'a b@c.d', '@c.d']) {
    assertEquals(to(bad), 'The invoice needs an email address to go to', bad)
  }
  assertEquals(
    to('clerk@township.test', 'x'.repeat(201)),
    'An organization’s name is 200 characters at most',
  )
})

// --- the Plus plan given free ---------------------------------------------

let NOW = Date.parse('2026-11-05T15:00:00.000Z')
let COMP = '2026-12-05T15:00:00.000Z'
let paying = plan()

test('a space given the Plus plan free is on it through that day, unless Stripe bills it', () => {
  assertEquals(tierOf('ana', null, COMP, NOW), 'plus')
  assertEquals(tierOf('ana', 'free', COMP, Date.parse(COMP) + 1), 'free')
  assertEquals(tierOf('ana', 'pro', COMP, NOW), 'pro')
  assertEquals(freeThrough({ plan: null, comped: COMP }, NOW), COMP)
  assertEquals(
    freeThrough({ plan: null, comped: COMP }, Date.parse(COMP)),
    null,
  )
  assertEquals(freeThrough({ plan: paying, comped: COMP }, NOW), null)
  assertEquals(freeThrough({ plan: null }, NOW), null)
})

// --- at-least-once, out of order ----------------------------------------

let row = (over: Partial<Plan> = {}): Plan => ({ ...plan(), ...over })

test('the same event twice writes nothing the second time', () => {
  let now = row()
  let again = plan()
  assert(
    !stale(now, again, standing),
    'a duplicate is not stale, it is simply the same',
  )
  assertEquals(moved(now, again), {}, 'and there is nothing to write')
})

test('deleted before an older updated does not revive the plan', () => {
  // The delete lands first, whatever its clock says...
  let dead = plan({ status: 'canceled', ending: AT })
  assertEquals(dead.tier, 'free')
  // ...and the update that was written earlier but arrived later is refused,
  // by the rule that an ended subscription is never revived — note its `at` is
  // LATER, so a clock comparison alone would have let it through.
  let late = plan({ status: 'active' }, LATER)
  assert(stale(dead, late, standing), 'a cancelled plan does not come back')
})

test('an event older than the row is dropped', () => {
  let now = row({ at: LATER, status: 'active' })
  assert(stale(now, plan({ status: 'past_due' }), standing))
  assert(
    !stale(now, plan({ status: 'past_due' }, LATER), standing),
    'the same moment stands',
  )
})

test('a new subscription after a cancelled one is not refused', () => {
  let dead = plan({ status: 'canceled' })
  let fresh = plan({ id: 'sub_2', status: 'active' }, LATER)
  assert(
    !stale(dead, fresh, standing),
    'a different subscription is a new sentence',
  )
  assertEquals(moved(dead, fresh).tier, 'plus')
})

test('a first plan is never stale', () => {
  assert(!stale(null, plan(), standing))
  assertEquals(Object.keys(moved(null, plan())).length, 7)
})

test('a plan is bought when a space moves onto a paid plan, and only then', () => {
  let free = plan({ status: 'canceled' })
  assert(bought(null, plan()), 'a first subscription')
  assert(
    bought(free, plan({ id: 'sub_2' }, LATER)),
    'one after a cancelled one',
  )
  assert(!bought(row(), plan({}, LATER)), 'a renewal')
  assert(
    !bought(row(), plan({ tier: 'pro' }, LATER)),
    'a change of plan',
  )
  assert(!bought(row(), free), 'a cancellation')
  assert(!bought(null, plan({ status: 'incomplete' })), 'a charge not yet made')
})

// --- whose purchase ------------------------------------------------------

test('another apex is elsewhere, and ours or none is not', () => {
  assert(elsewhere({ apex: 'yaks.app' }, 'yaks.fyi'))
  assert(!elsewhere({ apex: 'yaks.fyi' }, 'yaks.fyi'))
  assert(!elsewhere({}, 'yaks.fyi'))
})

test('a subscription no space holds is lost in live mode, and in the sandbox only when it names our apex', () => {
  let bought = (apex?: string) =>
    sub({ tags: { space: 'space-eid', ...apex ? { apex } : {} } })
  assert(lost(bought(), true, 'yaks.fyi'))
  assert(lost(bought('yaks.fyi'), false, 'yaks.fyi'))
  // A probe's, bought in the shared sandbox before the apex was stamped.
  assert(!lost(bought(), false, 'yaks.fyi'))
})
