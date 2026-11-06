// The month an invite gives (D-136811 'Invites', T-138778). Each person who
// signs up through someone's invite (referral.ts `credit`) and builds their
// first app gives the person who invited them one more free month of the
// Plus plan, on the space that is theirs (directory.ts `own`), months
// stacking. Jeff: "free month of paid *per* invitee that signs up and builds
// an app".
//
// The month goes through the billing the space already has. A space Stripe
// bills, on a subscription active or in a trial, has its next charge moved a
// month later: the subscription's trial is set to end then, prorating
// nothing, so the webhook writes its plan as it writes every change
// (billing.ts). Any other space is given the Plus plan free through a day
// (`comped{until}`), which directory.ts `tierOf` reads as the Plus plan and
// checkout carries into a subscription as its trial. Stripe's Managed
// Payments makes subscriptions only through Checkout, so a free space cannot
// be handed a subscription of its own.
//
// Inviting yourself is against the terms, and is watched (the admin's
// Invites page), never refused here.
import { periodEnd, type Sub } from './billing.ts'
import { type Directory, paid, type Referral, type Space } from './directory.ts'
import { ask, type Paying } from './payments.ts'

/// monthOn('2026-11-05T15:00:00.000Z') -> '2026-12-05T15:00:00.000Z'
/// monthOn('2026-01-31T10:00:00.000Z') -> '2026-02-28T10:00:00.000Z'
/// monthOn('2026-12-31T10:00:00.000Z') -> '2027-01-31T10:00:00.000Z'
/** A calendar month after `from`, on its last day where the month is short,
 * as Stripe counts a month. */
export let monthOn = (from: string) => {
  let at = new Date(from)
  let day = at.getUTCDate()
  at.setUTCDate(1)
  at.setUTCMonth(at.getUTCMonth() + 1)
  let last = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0))
  at.setUTCDate(Math.min(day, last.getUTCDate()))
  return at.toISOString()
}

/// later('2026-11-05T00:00:00.000Z', '2026-12-01T00:00:00.000Z') -> '2026-12-01T00:00:00.000Z'
/// later('2026-11-05T00:00:00.000Z', null) -> '2026-11-05T00:00:00.000Z'
/** The later of two moments. */
export let later = (a: string, b?: string | null) =>
  b && Date.parse(b) > Date.parse(a) ? new Date(b).toISOString() : a

/** The subscription a month moves, where Stripe bills the space on one it
 * can: active or in a trial. One past due is given the month as a comp, like
 * a free space, so the month holds whatever becomes of the card. */
export let billed = (space: Pick<Space, 'plan'>) =>
  space.plan?.subscription && paid(space.plan.tier) &&
    ['active', 'trialing'].includes(space.plan.status)
    ? space.plan.subscription
    : null

let path = (subscription: string) =>
  `/v1/subscriptions/${encodeURIComponent(subscription)}`

/** When a subscription next charges: the end of its trial, else of the
 * period paid for; null where Stripe says neither. */
export let charges = async (env: Paying, subscription: string) => {
  let sub = await ask(env, path(subscription)) as Sub & {
    trial_end?: number | null
  }
  let end = Math.max(sub.trial_end ?? 0, periodEnd(sub) ?? 0)
  return end ? new Date(end * 1000).toISOString() : null
}

/** The subscription's next charge moved to `until`, unless it already falls
 * then or later: asked again, it moves nothing twice. */
export let postpone = async (
  env: Paying,
  subscription: string,
  until: string,
) => {
  let next = await charges(env, subscription)
  if (next && Date.parse(next) >= Date.parse(until)) return
  await ask(env, path(subscription), {
    trial_end: Math.floor(Date.parse(until) / 1000),
    proration_behavior: 'none',
  })
}

type Rewarding = Pick<
  Directory,
  'appAt' | 'owners' | 'referral' | 'own' | 'stamp'
>

/**
 * The month one referral gives, given once: the mark on the referral and,
 * for a space Stripe does not bill, its free time, in one write. A month on a
 * subscription is marked before Stripe hears of it, so a run that stopped
 * between the two moves the charge when it runs again, and moves it once.
 */
export let reward = async (
  dir: Pick<Rewarding, 'own' | 'stamp'>,
  env: Paying,
  referral: Referral,
  now = new Date().toISOString(),
) => {
  let given = referral.rewarded
  if (given) {
    if (given.subscription) {
      await postpone(env, given.subscription, given.until)
    }
    return
  }
  let space = await dir.own(referral.inviter)
  let subscription = billed(space)
  let until = monthOn(
    later(now, subscription ? await charges(env, subscription) : space.comped),
  )
  let rewarded = {
    at: now,
    space: space.eid,
    until,
    ...(subscription ? { subscription } : {}),
  }
  await dir.stamp({
    entities: [
      { entity: { eid: referral.eid }, rewarded },
      ...subscription
        ? []
        : [{ entity: { eid: space.eid }, comped: { until } }],
    ],
  })
  if (subscription) await postpone(env, subscription, until)
}

/**
 * What an app being made owes: the month for each owner of its space whom
 * somebody invited, the first time one of them builds; nobody invited owes
 * nothing. A copy of somebody else's app is no app of theirs, so the effect
 * that runs this is never owed one (`reward_referral`'s target).
 */
export let rewarding = async (
  dir: Rewarding,
  env: Paying,
  app: string,
  now = new Date().toISOString(),
) => {
  let made = await dir.appAt(app)
  if (!made) return
  for (let owner of await dir.owners(made.space)) {
    let referral = await dir.referral(owner)
    if (referral) await reward(dir, env, referral, now)
  }
}
