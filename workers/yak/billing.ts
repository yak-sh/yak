// The paid tiers (D-32751, T-33125; the Organization plan, D-134567): what a
// space pays, its two doors — checkout and the customer portal — and what a
// subscription changing, as the payment provider heard it at its webhook door
// (payment-doors.ts), does to a space's plan. The provider is the plans
// config.ts `payments` lends (payments.ts, @yaks/host/payments): it mints a
// payer, opens its hosted checkout and portal, and reads a subscription into
// `{id, payer, tier, status, until, ending}`, deciding which tier a price
// buys and where a status stands. What a space may buy, who may buy it, and
// every refusal a person reads are this file's.
//
// The one idea: `plan` on a space is a function of one subscription, never a
// running total of the events that arrived. Every webhook ends at
// `planOf(sub)` — derive the whole row, then write what moved. That is what
// makes an at-least-once, out-of-order delivery safe, and it is why there is no
// state machine here: a replay derives the same row and writes nothing, a late
// event is refused by `stale`, and nothing can walk a cancelled plan back to
// paid by arriving in the wrong order.
//
// Two rules make `stale`, and neither is a clock alone:
//
//   1. A subscription this row has already seen end is never revived. The
//      provider never moves a subscription out of `ended`, so an event that
//      says otherwise is an older one that took a slower road — deleted before
//      an older update is the ordinary case, and a timestamp comparison is not
//      what should decide whether somebody's cancelled plan comes back.
//   2. Otherwise the newest event wins: an event created before the one that
//      wrote the row is dropped.
//
// Nothing here may fail quietly. A signature we cannot verify, a checkout we
// cannot create, a subscription of ours we cannot attribute to a space — each
// is reported to the tracker (unseen.ts `fault`), not a line on a log nobody
// opens.
//
// The kernel writes `plan` and no client ever can: every property is stamped in
// the vocabulary, so `admitted()` drops them off any write that does not carry
// the kernel flag. `tier` is what usage.ts `ceilings()` reads, and a tier a
// person could write is a person who can lift their own ceilings.
import type {
  Changed,
  Per,
  Plans,
  Standing,
  Subscription,
  Tags,
} from '@yaks/host/payments'
import { planSettings } from './route.ts'
import * as dirPart from './directory.ts'
import {
  directory,
  paid,
  type Plan,
  type Space,
  stamp,
  type Tier,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import { apex, type Host } from './host.ts'

import { step } from './funnel.ts'
import { sessionAt } from './session.ts'
import { fault } from './unseen.ts'
import { plans } from './payments.ts'

// ---- the plan, derived from one subscription -----------------------------

/** Where a subscription's status stands, as its provider reads it. */
export type Stands = (status: string) => Standing

/** Whether a subscription with this status still holds its plan: paid for,
 * or owing while a failed charge is retried. */
let holds = (standing: Standing) => standing == 'paying' || standing == 'owing'

/** No plan yet: a space the provider has never billed. */
let none: Plan = {
  tier: 'free',
  customer: '',
  subscription: '',
  status: '',
  until: null,
  ending: null,
  at: '',
}

// One subscription, as the whole plan row. `at` is the moment of the event
// this was derived from — the row's own marker for how new it is.
export let planOf = (sub: Subscription, at: string, stands: Stands): Plan => ({
  tier: holds(stands(sub.status)) ? sub.tier as Tier : 'free',
  customer: sub.payer,
  subscription: sub.id,
  status: sub.status,
  until: sub.until,
  ending: sub.ending,
  at,
})

// An event that must not be applied. The two rules in the header, in order:
// a subscription already ended is never revived, and otherwise an event older
// than the one that wrote the row is dropped.
export let stale = (now: Plan | null, next: Plan, stands: Stands) => {
  if (!now) return false
  let ended = (plan: Plan) => stands(plan.status) == 'ended'
  if (
    now.subscription && now.subscription == next.subscription &&
    ended(now) && !ended(next)
  ) return true
  return !!now.at && next.at < now.at
}

// What actually moves, property by property. A duplicate delivery derives an
// identical row — the same event carries the same `at` — so this is empty and
// the write below never happens at all: idempotent because there is nothing to
// write, not because a second write happened to be harmless. Over any row of
// properties, because sell.ts derives a seller's row the same way and the rule
// is the rule rather than the plan's own.
export let moved = <T extends Record<string, unknown>>(
  now: T | null,
  next: T,
) => {
  let out: Record<string, unknown> = {}
  for (let [k, v] of Object.entries(next)) if (!now || now[k] !== v) out[k] = v
  return out
}

// Whether this row moves a space onto a paid plan it was not on: the funnel's
// plan bought (funnel.ts). A duplicate or a stale event never gets this far,
// and a change between paid plans or a renewal is no purchase.
export let bought = (now: Plan | null | undefined, next: Plan) =>
  !paid(now?.tier) && paid(next.tier)

// ---- who this subscription belongs to ------------------------------------

type Dir = ReturnType<typeof directory>

// The space a subscription is about. The subscription's own tags are the
// answer we put there at checkout, so they are the one that always works; the
// payer is the fallback for a subscription minted any other way, and it
// works because a space keeps one payer for its whole life.
let whose = async (
  dir: Dir,
  at: { space?: string; customer?: string },
): Promise<Space | null> => {
  if (at.space) {
    let mine = await dir.at(at.space)
    if (mine) return mine
  }
  return at.customer ? await dir.payer(at.customer) : null
}

// What every object the provider makes for a space carries: the space, and
// the apex it was bought on. One sandbox serves staging and every probe
// kernel, and each of them hears the others' events; a space eid names nothing
// outside the store that made it, so without the apex a probe's purchase reads
// on staging as money nobody owns.
let tagsOf = (env: Host, space: Space): Tags => ({
  space: space.eid,
  slug: space.slug,
  apex: apex(env),
})

// Whether something the provider holds is another deployment's: its tags name
// an apex, and not ours. Tags naming none may be ours (made before the apex
// was stamped, T-38060), and the webhook asks the directory.
export let elsewhere = (tags: Tags, here: string) =>
  !!tags.apex && tags.apex != here

// Whether a subscription no space here holds is still ours to answer for.
// With live money it is: only this deployment holds the live key, so it is
// money we cannot place. In the sandbox it is only when it names our apex: one
// naming none is from before the stamp, and every probe kernel bought in this
// sandbox too, so a subscription none of our spaces holds is a probe's
// leftover.
export let lost = (
  sub: Pick<Subscription, 'tags'>,
  live: boolean,
  here: string,
) => live || sub.tags.apex == here

// ---- the doors -----------------------------------------------------------

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

// Who is buying: the platform session cookie, and nothing else. Deliberately
// not identity.ts's `withAuth`, which also answers an agent's OAuth bearer —
// these two doors belong to the signed-in web surface, and an agent that
// cannot reach them cannot be talked into starting a purchase (C-33033 on
// D-32751). It also keeps the oauth provider off this module's import graph,
// which is what lets its seams be tested without a runtime.
let buyer = async (env: Env, req: Request) => {
  return (await sessionAt(req, env.SESSION_SECRET))?.person ?? null
}

// The payer this space pays as, minted the first time it needs one and kept
// forever after — so a person who opens checkout twice does not leave two
// payers behind, and every later event about them finds the space by
// `plan.customer` even when its tags do not survive.
let payerFor = async (
  env: Env,
  lent: Plans,
  space: Space,
  email: string,
) => {
  if (space.plan?.customer) return space.plan.customer
  let customer = await lent.payer({
    email,
    name: space.title,
    tags: tagsOf(env, space),
  })
  await stamp(env, {
    entities: [{ entity: { eid: space.eid }, plan: { customer } }],
  })
  // The row we just wrote, so the caller reads a space that knows its payer.
  space.plan = { ...(space.plan ?? none), customer }
  return customer
}

// ---- what is for sale -----------------------------------------------------

/** A plan a person can buy, and how often it is paid for. */
export type Want = { tier: 'plus' | 'organization'; per: Per }

/** What a checkout form asks for: `plan=organization` and `per=year`, each
 * optional, so a form that names neither buys the Plus plan by the month as
 * it always has. */
export let wanted = (form: FormData | null): Want => ({
  tier: form?.get('plan') == 'organization' ? 'organization' : 'plus',
  per: form?.get('per') == 'year' ? 'year' : 'month',
})

/** What the signed-in plan card shows (pages.ts `plan`): the space's tier,
 * the day it lapses if it is leaving, whether the provider has ever known it
 * — which is what makes the manage door worth offering — and how the
 * Organization plan is sold here: by the month, by the year, or not yet at
 * all. */
export type Card = {
  tier: Tier
  ends: string
  known: boolean
  /** the day the Plus plan given free runs through, while it does */
  free?: string
  organization?: Want['per'][]
}

/** The day a space's Plus plan given free runs through (`comped`, a month
 * for each person its owner invited who built an app), while it runs and
 * the provider bills the space nothing; null otherwise. */
export let freeThrough = (
  space: Pick<Space, 'plan' | 'comped'>,
  now = Date.now(),
) =>
  !paid(space.plan?.tier) && space.comped && Date.parse(space.comped) > now
    ? space.comped
    : null

export let planCard = (lent: Plans, space: Space): Card => {
  let free = freeThrough(space)
  return {
    tier: space.tier ?? 'free',
    ends: space.plan?.ending ?? '',
    known: !!space.plan?.customer,
    ...(free ? { free } : {}),
    organization: (['month', 'year'] as const).filter((per) =>
      lent.offers('organization', per)
    ),
  }
}

/** Whom a space is billed to: the email and name its payer holds, which is
 * where the receipts go and what the portal changes. */
export type Payer = { email: string; name: string }

/** Whom the provider bills for a space; null for a space it has never met,
 * or whose payer was deleted there. */
export let billedTo = async (
  lent: Plans,
  space: Space,
): Promise<Payer | null> => {
  let customer = space.plan?.customer
  if (!customer || !lent.on()) return null
  return await lent.billed(customer)
}

/** A tier as its plan is said: "the Plus plan", never bare "Plus". */
export let planName = (tier: Tier) =>
  tier == 'organization'
    ? 'the Organization plan'
    : tier == 'plus'
    ? 'the Plus plan'
    : 'the free plan'

// Where checkout hands somebody back. Both are on our own zone, and both are
// the connector page, which is where a signed-in person manages their space.
let backTo = (done: boolean, env: Host) =>
  `https://${apex(env)}/connect?${done ? 'paid=1' : 'paid=0'}`

// Start a subscription. Answers the URL to send the person to, and nothing
// else: this door is reachable from a signed-in page only, never from a tool.
export let checkout = async (
  env: Env,
  req: Request,
  at?: Space,
  want: Want = { tier: 'plus', per: 'month' },
) => {
  let person = await buyer(env, req)
  if (!person) return json(401, 'unauthorized', 'sign in first')
  let lent = await plans(env)
  if (!lent.offers(want.tier, want.per)) {
    return json(
      503,
      'no_billing',
      `${planName(want.tier)} is not on sale here${
        want.per == 'year' ? ' by the year' : ''
      }`,
    )
  }
  let dir = dirOf(env)
  let space = at ?? await dir.own(person)
  if (await dir.role(space, person) != 'owner') {
    return json(
      403,
      'not_the_owner',
      `only ${space.slug}'s owner may pay for it`,
    )
  }
  // One subscription per space: a second would charge twice. A change of
  // plan is the portal's, where the provider prorates it. A space on the Plus
  // plan free subscribes for after it, its trial lasting as long as the free
  // time.
  let free = freeThrough(space)
  if (paid(space.tier) && !free) {
    return json(
      409,
      'already_paid',
      `${space.slug} is already on ${
        planName(space.tier!)
      }; Manage billing changes it`,
    )
  }
  let email = await dir.emailAt(person) ?? ''
  try {
    let url = await lent.checkout({
      payer: await payerFor(env, lent, space, email),
      tier: want.tier,
      per: want.per,
      done: at ? `${planSettings(at.slug, env)}?paid=1` : backTo(true, env),
      cancel: at ? `${planSettings(at.slug, env)}?paid=0` : backTo(false, env),
      reference: space.eid,
      tags: tagsOf(env, space),
      trial: free,
    })
    step(env, 'checkout', req)
    return Response.json({ url })
  } catch (e) {
    await fault(env, 'POST /api/billing/checkout', e)
    return json(
      502,
      'checkout_failed',
      "we couldn't start that — it's been logged, try again in a minute",
    )
  }
}

// Manage what is already paid for: the provider's own portal, where a person
// cancels, changes their card and reads their invoices. A portal the provider
// refuses to open is filed and said rather than swallowed.
export let portal = async (env: Env, req: Request, at?: Space) => {
  let person = await buyer(env, req)
  if (!person) return json(401, 'unauthorized', 'sign in first')
  let lent = await plans(env)
  if (!lent.on()) {
    return json(503, 'no_billing', 'the paid tier is not switched on here')
  }
  let dir = dirOf(env)
  let space = at ?? await dir.own(person)
  if (await dir.role(space, person) != 'owner') {
    return json(
      403,
      'not_the_owner',
      `only ${space.slug}'s owner may manage it`,
    )
  }
  let customer = space.plan?.customer
  if (!customer) {
    return json(
      404,
      'nothing_to_manage',
      `${space.slug} has never paid for anything`,
    )
  }
  try {
    let url = await lent.portal(
      customer,
      at ? planSettings(at.slug, env) : `https://${apex(env)}/connect`,
    )
    return Response.json({ url })
  } catch (e) {
    await fault(env, 'POST /api/billing/portal', e)
    return json(
      502,
      'portal_failed',
      "we couldn't open your billing page — it's been logged, try again in a minute",
    )
  }
}

// ---- a subscription changed ---------------------------------------------

// One verified event, applied. Answers what it did, which is what the door
// says back — the provider ignores the body, and a person reading the logs
// does not.
export let apply = async (env: Env, heard: Changed) => {
  let lent = await plans(env)
  // Another deployment's purchase is its business, not a fault of ours, and it
  // is let go before a read that our key may not even be able to answer.
  let here = apex(env)
  if (elsewhere(heard.tags, here)) return 'elsewhere'
  let sub = await heard.subscription()
  if (sub === undefined) return 'nothing to do'
  // Every subscription bought through this deployment is made with its own
  // key, so one in the sandbox that key cannot see was made elsewhere (by
  // hand, or by another deployment) and is not ours. With live money only
  // this deployment holds the key, and it is a fault.
  if (sub === null) {
    if (!heard.live) return 'elsewhere'
    throw new Error('a live event names a subscription the provider lacks')
  }
  if (elsewhere(sub.tags, here)) return 'elsewhere'
  let next = planOf(sub, heard.at, lent.standing)
  let dir = dirOf(env)
  let space = await whose(dir, {
    space: sub.tags.space || heard.reference || heard.tags.space,
    customer: next.customer,
  })
  if (!space) {
    if (!lost(sub, heard.live, here)) return 'elsewhere'
    // Money changed hands and we cannot say whose it was. Nothing to retry —
    // a second delivery finds the same nothing — so it is filed where the
    // owner reads it and the door answers 200 rather than making the provider
    // repeat an unanswerable question for three days.
    await fault(
      env,
      'a subscription heard',
      new Error(
        `no space owns subscription ${next.subscription} ` +
          `(customer ${next.customer})`,
      ),
    )
    return 'unattributed'
  }
  if (stale(space.plan, next, lent.standing)) return 'stale'
  let changed = moved(space.plan, next)
  if (!Object.keys(changed).length) return 'unchanged'
  await stamp(env, {
    entities: [{ entity: { eid: space.eid }, plan: changed }],
  })
  // Counted with no request: the provider's delivery says nothing of the
  // person who paid.
  if (bought(space.plan, next)) step(env, 'paid')
  return `${space.slug} is ${next.tier}`
}

export let fetch = (req: Request, env: Env): Promise<Response> => {
  let path = new URL(req.url).pathname
  if (req.method != 'POST') {
    return Promise.resolve(
      json(405, 'method_not_allowed', 'post to this door'),
    )
  }
  if (path == '/api/billing/checkout') {
    return req.formData().catch(() => null).then((form) =>
      checkout(env, req, undefined, wanted(form))
    )
  }
  if (path == '/api/billing/portal') return portal(env, req)
  return Promise.resolve(json(404, 'not_found', 'no door here'))
}
