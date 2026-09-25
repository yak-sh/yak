// The paid tier at its seams (billing.ts, T-33125): the plan derived from one
// subscription, which is the whole of the idempotency and ordering story, so it
// is tested here rather than only through the door. Stripe's signature is
// @yaks/hook's (signed_test.ts).
import { assert, assertEquals } from '@std/assert'
import {
  elsewhere,
  form,
  moved,
  periodEnd,
  planOf,
  stale,
  type Sub,
} from './billing.ts'
import type { Plan } from './directory.ts'

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

Deno.test('the period end is read off the item, and off the subscription', () => {
  // Where it lives since API 2025-03-31.basil...
  assertEquals(periodEnd(sub()), PERIOD)
  // ...and where it lived before, which an older api_version still sends.
  assertEquals(periodEnd({ current_period_end: 42, items: { data: [] } }), 42)
  assertEquals(periodEnd({}), null)
})

Deno.test('a paying subscription is plus, and the rest are free', () => {
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

Deno.test('cancelled but paid through says both, in one row', () => {
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

Deno.test('the same event twice writes nothing the second time', () => {
  let now = row()
  let again = planOf(sub(), AT)
  assert(!stale(now, again), 'a duplicate is not stale, it is simply the same')
  assertEquals(moved(now, again), {}, 'and there is nothing to write')
})

Deno.test('deleted before an older updated does not revive the plan', () => {
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

Deno.test('an event older than the row is dropped', () => {
  let now = row({ at: LATER, status: 'active' })
  assert(stale(now, planOf(sub({ status: 'past_due' }), AT)))
  assert(
    !stale(now, planOf(sub({ status: 'past_due' }), LATER)),
    'the same moment stands',
  )
})

Deno.test('a new subscription after a cancelled one is not refused', () => {
  let dead = planOf(sub({ status: 'canceled' }), AT)
  let fresh = planOf(sub({ id: 'sub_2', status: 'active' }), LATER)
  assert(!stale(dead, fresh), 'a different subscription is a new sentence')
  assertEquals(moved(dead, fresh).tier, 'plus')
})

Deno.test('a first plan is never stale', () => {
  assert(!stale(null, planOf(sub(), AT)))
  assertEquals(Object.keys(moved(null, planOf(sub(), AT))).length, 7)
})

// --- what goes on the wire to Stripe -------------------------------------

Deno.test('form encoding nests the way Stripe reads it', () => {
  assertEquals(
    form({
      mode: 'subscription',
      line_items: { 0: { price: 'price_1', quantity: 1 } },
      managed_payments: { enabled: true },
      metadata: { space: 'e1' },
      customer: null,
    }),
    [
      ['mode', 'subscription'],
      ['line_items[0][price]', 'price_1'],
      ['line_items[0][quantity]', '1'],
      ['managed_payments[enabled]', 'true'],
      ['metadata[space]', 'e1'],
    ],
  )
})

// --- whose purchase ------------------------------------------------------

Deno.test('another apex is elsewhere; ours, or none, is ours', () => {
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
