// The paid tier at its seams (billing.ts, T-33125): the signature over the raw
// body, and the plan derived from one subscription — which is the whole of the
// idempotency and ordering story, so it is tested here rather than only
// through the door.
import { assert, assertEquals } from '@std/assert'
import {
  form,
  moved,
  periodEnd,
  planOf,
  SKEW,
  stale,
  type Sub,
  verified,
} from './billing.ts'
import type { Plan } from './directory.ts'

let SECRET = 'whsec_a_probe_secret'

let hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join(
    '',
  )

// What Stripe puts on the wire: `t=<unix>,v1=<hmac of "t.body">`. The tests
// sign the same way the door verifies, so a change to either side shows here.
export let signature = async (raw: string, at: number, secret = SECRET) => {
  let key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  let mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${at}.${raw}`),
  )
  return `t=${at},v1=${hex(mac)}`
}

let NOW = 1_788_460_000_000
let SEC = Math.floor(NOW / 1000)

Deno.test('a signature over the exact bytes verifies', async () => {
  let raw = '{"id":"evt_1","type":"invoice.paid"}'
  assertEquals(await verified(raw, await signature(raw, SEC), SECRET, NOW), '')
})

Deno.test('a body that moved by one byte does not', async () => {
  let raw = '{"id":"evt_1"}'
  let sig = await signature(raw, SEC)
  assertEquals(
    await verified(`${raw} `, sig, SECRET, NOW),
    'the signature does not match',
  )
})

Deno.test('another secret does not', async () => {
  let raw = '{"id":"evt_1"}'
  assertEquals(
    await verified(
      raw,
      await signature(raw, SEC, 'whsec_someone_else'),
      SECRET,
      NOW,
    ),
    'the signature does not match',
  )
})

Deno.test('a stale timestamp is refused before the mac is even asked', async () => {
  let raw = '{"id":"evt_1"}'
  let old = SEC - SKEW - 1
  assertEquals(
    await verified(raw, await signature(raw, old), SECRET, NOW),
    'the signature is too old',
  )
  // And one just inside the window still verifies, so the edge is the edge.
  let edge = SEC - SKEW + 1
  assertEquals(await verified(raw, await signature(raw, edge), SECRET, NOW), '')
})

Deno.test('a header with no signature at all is refused', async () => {
  assertEquals(
    await verified('{}', null, SECRET, NOW),
    'no Stripe-Signature header',
  )
  assertEquals(
    await verified('{}', 'v1=abcd', SECRET, NOW),
    'no timestamp on the signature',
  )
  assertEquals(
    await verified('{}', `t=${SEC}`, SECRET, NOW),
    'the signature does not match',
  )
  // Not hex, and odd-length hex: neither may throw its way past the check.
  assertEquals(
    await verified('{}', `t=${SEC},v1=zzzz`, SECRET, NOW),
    'the signature does not match',
  )
  assertEquals(
    await verified('{}', `t=${SEC},v1=abc`, SECRET, NOW),
    'the signature does not match',
  )
})

Deno.test('a rolled secret sends both signatures and either may match', async () => {
  let raw = '{"id":"evt_1"}'
  let mine = await signature(raw, SEC)
  let theirs = await signature(raw, SEC, 'whsec_the_old_one')
  // The one that matches arrives second — a Map keyed by name would have kept
  // only the last and thrown ours away.
  assertEquals(
    await verified(raw, `${theirs},${mine.split(',')[1]}`, SECRET, NOW),
    '',
  )
})

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
  // ...and the update that was written EARLIER but arrived later is refused,
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
