// AI credit (D-134567) through the directory: a block paid for is credited
// once however often Stripe tells it, a spend past the budget draws on it up
// to the cap and no further, and what a month leaves carries to the next. The
// checkout session each delivery carries is a fabricated one, the shape
// @yaks/stripe's `changed` reads; nothing is asked of Stripe.
import { equal, ok, test } from '@yaks/testing'
import { delivered } from '@yaks/stripe/testing'
import { platform } from './directory-rows-probe.ts'
import { paymentDoor } from './payment-doors.ts'
import { type Space, stamp } from './directory.ts'
import {
  buyable,
  capped,
  creditLeft,
  creditOf,
  limitOf,
  monthOf,
} from '@yaks/platform/meter'
import { badCap, planCard } from './billing.ts'
import { capNotice } from './usage.ts'
import { plans } from './payments.ts'

test('a block is credited once, spent past the budget up to the cap, and carried to next month', async () => {
  let secret = 'credit webhook'
  await using p = platform('credit fixture', { STRIPE_WEBHOOK_SECRET: secret })
  let { dir, env } = p
  let eid = crypto.randomUUID()
  await dir.stamp({
    entities: [{
      entity: { eid },
      doc: { title: 'Township' },
      space: { slug: 'township', store: 'township' },
    }],
  })
  let now = new Date()
  let month = monthOf(now)
  let space = async () => (await dir.at(eid))!
  let spend = (models: number, held = false) =>
    stamp(env, {
      entities: [{ entity: { eid }, spend: { month, models, held } }],
    })
  // A budget of $1 and no starter, so the figures are the credit's.
  await stamp(env, {
    entities: [{
      entity: { eid },
      plan: { tier: 'pro' },
      budget: { dollars: 1 },
      starter: { dollars: 0 },
    }],
  })
  equal([creditOf(await space()), limitOf(await space())], [0, 1])
  equal(buyable(await space()), false, 'no block before a cap')

  await stamp(env, { entities: [{ entity: { eid }, credit: { cap: 15 } }] })
  ok(buyable(await space()))
  let paid = (checkout: string) =>
    delivered(
      async (path, init) =>
        (await paymentDoor(new Request(`https://yaks.app${path}`, init), env))!,
      '/stripe/webhook',
      secret,
      'checkout.session.completed',
      {
        id: checkout,
        mode: 'payment',
        payment_status: 'paid',
        client_reference_id: eid,
        metadata: { apex: 'yaks.app', space: eid, credit: '10' },
      },
    ).then((said) => JSON.parse(said).did)
  equal(await paid('cs_one'), 'township bought $10 of credit')
  equal(await paid('cs_one'), 'already credited')
  equal((await space()).credit, { cap: 15, bought: 10, spent: 0 })
  equal(buyable(await space()), false, 'another block passes the cap')

  // $3 past the $1 budget is drawn from the credit, in the spend's write.
  await spend(4)
  let s = await space()
  equal([s.credit!.spent, s.meter!.credit, creditLeft(s)], [3, 3, 7])
  // A held call that does not fit what is left is refused.
  let refused = await spend(8, true).then(() => false, () => true)
  ok(refused, 'past budget and credit')
  await spend(7, true)
  s = await space()
  equal([s.credit!.spent, creditLeft(s), capped(s)], [10, 0, 'at'])
  ok(capNotice(s, now)!.words.includes('spent the AI credit it bought'))

  // Next month the space holds what it bought less what it spent: $10 of
  // its $15 cap, so another block would pass it.
  let next = new Date(Date.parse(month + '-01T00:00:00Z') + 40 * 864e5)
  await paid('cs_two')
  s = await space()
  equal([s.credit!.bought, creditOf(s, next), buyable(s, next)], [
    20,
    10,
    false,
  ])
})

test('a space with no credit is billed and limited as before', async () => {
  let none = {
    tier: 'plus',
    plan: null,
    credit: null,
    budget: null,
    starter: 0,
    meter: null,
  } as unknown as Space
  equal([creditOf(none), capped(none), buyable(none)], [0, null, false])
  equal(limitOf(none, new Date('2026-12-01T00:00:00Z')), 8)
  equal(planCard(await plans({}), none).credit, undefined)
  equal(planCard(await plans({}), { ...none, tier: 'pro' }).credit, {
    cap: 0,
    left: 0,
    drawn: 0,
    buy: false,
  })
})

test('a cap is whole dollars within reason', () => {
  equal([0, 10, 250, 10_000].map(badCap), [null, null, null, null])
  for (let bad of [-10, 2.5, NaN, 10_001]) ok(badCap(bad), String(bad))
})
