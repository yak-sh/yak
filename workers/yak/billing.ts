// The paid tiers (D-32751, T-33125; the Organization plan, D-134567): what a
// space pays, and the three doors it
// takes — checkout, the customer portal, and the webhook Stripe posts the
// truth to. Stripe is the merchant of record here (Managed Payments): the
// Checkout Session carries `managed_payments[enabled]=true`, Stripe sells,
// collects and remits the tax, and the parameters it controls — automatic_tax,
// payment_method_types, tax_id_collection, customer_update, invoice_creation —
// must not be sent at all, so none of them appear below.
//
// The one idea: `plan` on a space is a function of one Stripe subscription
// object, never a running total of the events that arrived. Every webhook ends
// at `planOf(sub)` — derive the whole row, then write what moved. That is what
// makes an at-least-once, out-of-order delivery safe, and it is why there is no
// state machine here: a replay derives the same row and writes nothing, a late
// event is refused by `stale`, and nothing can walk a cancelled plan back to
// paid by arriving in the wrong order.
//
// Two rules make `stale`, and neither is a clock alone:
//
//   1. A subscription this row has already seen end is never revived. Stripe
//      never moves a subscription out of `canceled`, so an event that says
//      otherwise is an older one that took a slower road — `deleted` before an
//      older `updated` is the ordinary case, and a timestamp comparison is not
//      what should decide whether somebody's cancelled plan comes back.
//   2. Otherwise the newest event wins: an event created before the one that
//      wrote the row is dropped.
//
// Nothing here may fail quietly. A signature we cannot verify, a checkout we
// cannot create, a subscription of ours we cannot attribute to a space — each
// is reported to the tracker (unseen.ts `fault`), not a line on a log nobody
// opens. The webhook door is public, so filing is capped per isolate
// (`FILED`): a stranger posting garbage must not be able to file without end.
//
// The kernel writes `plan` and no client ever can: every property is stamped in
// the vocabulary, so `admitted()` drops them off any write that does not carry
// the kernel flag. `tier` is what usage.ts `ceilings()` reads, and a tier a
// person could write is a person who can lift their own ceilings.
//
// Which paid tier a subscription buys is read off its price, never off
// metadata a checkout wrote: a plan changed in Stripe's portal moves the price
// and nothing else. A price that is not one of the Organization plan's is the
// Plus plan, so every subscription made before the Organization plan existed
// reads exactly as it did.
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

import { sessionAt } from './session.ts'
import { ours, refusal } from '@yaks/hook'
import { fault } from './unseen.ts'
import { ask, StripeError } from './stripe.ts'

// ---- the signature -------------------------------------------------------

// Stripe signs `<timestamp>.<raw body>` with the endpoint's secret; @yaks/hook
// holds that scheme (`refusal('stripe', …)`), for this door and sell.ts's.

// ---- the plan, derived from one subscription -----------------------------

// The slice of a Stripe subscription this reads. Everything is optional: the
// shape is Stripe's to move, and a field that went missing must leave a
// readable row rather than a throw in the middle of somebody's billing.
export type Sub = {
  id?: string
  customer?: string | { id?: string }
  status?: string
  metadata?: Record<string, string>
  cancel_at?: number | null
  cancel_at_period_end?: boolean
  canceled_at?: number | null
  ended_at?: number | null
  current_period_end?: number | null
  items?: {
    data?: {
      current_period_end?: number | null
      price?: string | { id?: string } | null
    }[]
  }
}

// What a subscription is worth paying attention to for. `past_due` keeps the
// plan on purpose: Stripe retries a failed card for days before it gives up,
// and taking somebody's apps away on the first decline is the wall T-32756
// says not to build. When Stripe does give up the status becomes `canceled` or
// `unpaid`, and both fall out of this list.
let PAYING = ['active', 'trialing', 'past_due']

// Over for good. Stripe never moves a subscription out of these, which is what
// makes rule 1 above true rather than a hopeful guess.
let ENDED = ['canceled', 'incomplete_expired']

export let ending = (status: string) => ENDED.includes(status)

let when = (unix?: number | null) =>
  unix == null ? null : new Date(unix * 1000).toISOString()

// When the paid-for period runs out. The field moved off the subscription onto
// each of its items in API version 2025-03-31.basil, and the account's default
// version is well past that — but the webhook endpoint pins no version of its
// own, so the version it sends can move under us. Read either shape and the
// answer survives that: the latest item wins, since one subscription of ours
// has exactly one item.
export let periodEnd = (sub: Sub) => {
  if (sub.current_period_end != null) return sub.current_period_end
  let ends = (sub.items?.data ?? [])
    .map((i) => i.current_period_end)
    .filter((n): n is number => typeof n == 'number')
  return ends.length ? Math.max(...ends) : null
}

let idOf = (v: string | { id?: string } | undefined) =>
  typeof v == 'string' ? v : v?.id ?? ''

// The paid tier a subscription buys: the Organization plan when one of its
// items is one of `organization`'s prices, and the Plus plan otherwise.
export let tierFor = (sub: Sub, organization: string[] = []): Tier =>
  (sub.items?.data ?? []).some((i) =>
      organization.includes(idOf(i.price ?? undefined))
    )
    ? 'organization'
    : 'plus'

// One subscription, as the whole plan row. `at` is the moment of the Stripe
// event this was derived from — the row's own marker for how new it is.
// `organization` is the Organization plan's prices ({@link organizationPrices}).
export let planOf = (
  sub: Sub,
  at: string,
  organization: string[] = [],
): Plan => {
  let status = sub.status ?? ''
  let end = periodEnd(sub)
  // Set only when the subscription will not renew, so "cancelled, but paid
  // through the 14th" is one row to read: an explicit `cancel_at`, else the
  // period end it is riding out, else — for one already over — when it ended.
  let ends = sub.cancel_at ??
    (sub.cancel_at_period_end ? end : null) ??
    (ending(status) ? sub.ended_at ?? sub.canceled_at ?? end : null)
  return {
    tier: PAYING.includes(status) ? tierFor(sub, organization) : 'free',
    customer: idOf(sub.customer),
    subscription: sub.id ?? '',
    status,
    until: when(end),
    ending: when(ends),
    at,
  }
}

// An event that must not be applied. The two rules in the header, in order:
// a subscription already ended is never revived, and otherwise an event older
// than the one that wrote the row is dropped.
export let stale = (now: Plan | null, next: Plan) => {
  if (!now) return false
  if (
    now.subscription && now.subscription == next.subscription &&
    ending(now.status) && !ending(next.status)
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

// ---- who this subscription belongs to ------------------------------------

type Dir = ReturnType<typeof directory>

// The space a Stripe object is about. The subscription's own metadata is the
// answer we PUT there at checkout, so it is the one that always works; the
// customer is the fallback for a subscription minted any other way, and it
// works because a space keeps one customer for its whole life.
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

// What every Stripe object we make for a space carries: the space, and the
// apex it was bought on. One Stripe sandbox serves staging and every probe
// kernel, and each of them hears the others' events; a space eid names nothing
// outside the store that made it, so without the apex a probe's purchase reads
// on staging as money nobody owns.
let metaOf = (env: Host, space: Space) => ({
  space: space.eid,
  slug: space.slug,
  apex: apex(env),
})

// The apex a Stripe object was bought on. The subscription says it in its own
// metadata, a checkout session in its own, and an invoice in the copy of its
// subscription's under `parent`. Something made before the apex was stamped
// (T-38060) names none.
let apexOf = (o: Record<string, unknown>) => {
  let parent = o.parent as
    | { subscription_details?: { metadata?: Record<string, string> } }
    | undefined
  return (o.metadata as Record<string, string> | undefined)?.apex ??
    parent?.subscription_details?.metadata?.apex
}

// Whether a Stripe object is another deployment's: it names an apex, and not
// ours. One that names none may be ours, and the webhook asks the directory.
export let elsewhere = (o: Record<string, unknown>, here: string) => {
  let at = apexOf(o)
  return !!at && at != here
}

// Whether a subscription no space here holds is still ours to answer for. In
// live mode it is: only this deployment holds the live key, so it is money we
// cannot place. In the sandbox it is only when it names our apex: one naming
// none is from before the stamp, and every probe kernel bought in this sandbox
// too, so a subscription none of our spaces holds is a probe's leftover.
export let lost = (sub: Sub, livemode: boolean | undefined, here: string) =>
  livemode !== false || apexOf(sub) == here

// ---- the doors -----------------------------------------------------------

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

// The webhook door is on the open internet, so what it files has a ceiling:
// per isolate, per minute, the way unseen.ts caps a crash-looping page. Only a
// refusal that can mean our secret is wrong is filed at all (`ours`, @yaks/hook):
// a well-formed signature that does not match is worth seeing once and never a
// hundred times an hour, and a request with no signature is a stranger's.
let FILED = 6
let filed = new Map<string, { minute: number; n: number }>()

let hushed = (what: string) => {
  let minute = Math.floor(Date.now() / 60_000)
  let hit = filed.get(what)
  if (!hit || hit.minute != minute) {
    filed.set(what, { minute, n: 1 })
    return false
  }
  return ++hit.n > FILED
}

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

// The Stripe customer this space pays as, minted the first time it needs one
// and kept forever after — so a person who opens checkout twice does not leave
// two customers behind, and every later event about them finds the space by
// `plan.customer` even when metadata does not survive.
let payerFor = async (env: Env, space: Space, email: string) => {
  if (space.plan?.customer) return space.plan.customer
  let made = await ask(env, '/v1/customers', {
    email,
    name: space.title,
    metadata: metaOf(env, space),
  })
  let customer = String(made.id ?? '')
  if (!customer) throw new Error('stripe made a customer with no id')
  await stamp(env, {
    entities: [{ entity: { eid: space.eid }, plan: { customer } }],
  })
  // The row we just wrote, so the caller reads a space that knows its customer.
  space.plan = { ...(space.plan ?? planOf({}, '')), customer }
  return customer
}

// ---- what is for sale -----------------------------------------------------

/** A plan a person can buy, and how often it is paid for. */
export type Want = { tier: 'plus' | 'organization'; per: 'month' | 'year' }

/** What a checkout form asks for: `plan=organization` and `per=year`, each
 * optional, so a form that names neither buys the Plus plan by the month as
 * it always has. */
export let wanted = (form: FormData | null): Want => ({
  tier: form?.get('plan') == 'organization' ? 'organization' : 'plus',
  per: form?.get('per') == 'year' ? 'year' : 'month',
})

/** The Organization plan's Stripe prices on this deployment, by month and
 * by year; empty until they exist. */
export let organizationPrices = (env: Env) =>
  [env.STRIPE_PRICE_ORGANIZATION, env.STRIPE_PRICE_ORGANIZATION_YEAR]
    .filter((p): p is string => !!p)

/** The Stripe price a want is charged against here, or none when it is not
 * on sale. The Plus plan is sold by the month only. */
export let priceFor = (env: Env, want: Want) =>
  want.tier == 'plus'
    ? want.per == 'month' ? env.STRIPE_PRICE : undefined
    : want.per == 'year'
    ? env.STRIPE_PRICE_ORGANIZATION_YEAR
    : env.STRIPE_PRICE_ORGANIZATION

/** What the signed-in plan card shows (pages.ts `plan`): the space's tier,
 * the day it lapses if it is leaving, whether Stripe has ever known it — which
 * is what makes the manage door worth offering — and how the Organization plan
 * is sold here: by the month, by the year, or not yet at all. */
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
 * Stripe bills the space nothing; null otherwise. */
export let freeThrough = (
  space: Pick<Space, 'plan' | 'comped'>,
  now = Date.now(),
) =>
  !paid(space.plan?.tier) && space.comped && Date.parse(space.comped) > now
    ? space.comped
    : null

/** The trial a subscription bought while the Plus plan is free starts with,
 * so the free time is kept and the first charge falls when it ends. Stripe
 * takes a trial ending no sooner than two days away, so one ending sooner
 * is two days. */
export let trialFor = (free: string | null, now = Date.now()) =>
  free
    ? {
      trial_end: Math.floor(
        Math.max(Date.parse(free), now + 49 * 60 * 60_000) / 1000,
      ),
    }
    : {}

export let planCard = (env: Env, space: Space): Card => {
  let free = freeThrough(space)
  return {
    tier: space.tier ?? 'free',
    ends: space.plan?.ending ?? '',
    known: !!space.plan?.customer,
    ...(free ? { free } : {}),
    organization: (['month', 'year'] as const).filter((per) =>
      !!env.STRIPE_KEY && !!priceFor(env, { tier: 'organization', per })
    ),
  }
}

/** Whom a space is billed to: the email and name its Stripe customer holds,
 * which is where the receipts go and what the customer portal changes. */
export type Payer = { email: string; name: string }

/** Whom Stripe bills for a space, read from its customer; null for a space
 * Stripe has never met, or whose customer was deleted there. */
export let billedTo = async (env: Env, space: Space): Promise<Payer | null> => {
  let customer = space.plan?.customer
  if (!customer || !env.STRIPE_KEY) return null
  let c = await ask(env, `/v1/customers/${encodeURIComponent(customer)}`)
  return c.deleted
    ? null
    : { email: String(c.email ?? ''), name: String(c.name ?? '') }
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
  let price = priceFor(env, want)
  if (!env.STRIPE_KEY || !price) {
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
  // plan is the portal's, where Stripe prorates it. A space on the Plus plan
  // free subscribes for after it, its trial lasting as long as the free time.
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
    let customer = await payerFor(env, space, email)
    // Managed Payments (T-33125): Stripe is the seller, so it owns tax,
    // payment methods and the customer's own details, and every parameter it
    // owns is one this call must not send. What is here is what is left, and
    // all of it survives Managed Payments — verified against the account, not
    // assumed: the space rides `client_reference_id` for the session and
    // `subscription_data[metadata]` for the subscription, which is what every
    // later `customer.subscription.*` event is attributed by.
    // `allow_promotion_codes` is not on the unsupported list either, and it is
    // what puts the code box on Stripe's page — the only place one belongs,
    // since Stripe is the seller and owns the price it charges.
    let made = await ask(env, '/v1/checkout/sessions', {
      mode: 'subscription',
      customer,
      line_items: { 0: { price, quantity: 1 } },
      success_url: at
        ? `${planSettings(at.slug, env)}?paid=1`
        : backTo(true, env),
      cancel_url: at
        ? `${planSettings(at.slug, env)}?paid=0`
        : backTo(false, env),
      client_reference_id: space.eid,
      metadata: metaOf(env, space),
      subscription_data: { metadata: metaOf(env, space), ...trialFor(free) },
      managed_payments: { enabled: true },
      allow_promotion_codes: true,
    })
    let url = String(made.url ?? '')
    if (!url) throw new Error('stripe made a checkout session with no url')
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

// Manage what is already paid for: Stripe's own customer portal, where a
// person cancels, changes their card and reads their invoices. It needs a
// portal configuration on the account; without one Stripe refuses, and the
// refusal is filed and said rather than swallowed.
export let portal = async (env: Env, req: Request, at?: Space) => {
  let person = await buyer(env, req)
  if (!person) return json(401, 'unauthorized', 'sign in first')
  if (!env.STRIPE_KEY) {
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
    let made = await ask(env, '/v1/billing_portal/sessions', {
      customer,
      return_url: at
        ? planSettings(at.slug, env)
        : `https://${apex(env)}/connect`,
    })
    let url = String(made.url ?? '')
    if (!url) throw new Error('stripe made a portal session with no url')
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

// ---- the webhook ---------------------------------------------------------

type Event = {
  id?: string
  type?: string
  created?: number
  livemode?: boolean
  data?: { object?: Record<string, unknown> }
}

// Whether Stripe could not find the subscription a sandbox event names. Every
// one bought through this deployment is made with its own key, so one that key
// cannot see was made elsewhere (by hand, or by another deployment) and is not
// ours. In live mode only this deployment holds the key, and it is a fault.
export let unseen = (e: unknown, event: Pick<Event, 'livemode'>) =>
  event.livemode === false && e instanceof StripeError &&
  e.code == 'resource_missing'

// The subscription an event is about, and the space to attribute it to. Two of
// the five events carry the subscription whole and are read from the payload
// itself; the other three name it, and one GET answers what they left out.
let subjectOf = async (
  env: Env,
  event: Event,
): Promise<{ sub: Sub; space?: string } | 'elsewhere' | null> => {
  let o = (event.data?.object ?? {}) as Record<string, unknown>
  let type = event.type ?? ''
  if (type.startsWith('customer.subscription.')) {
    let sub = o as Sub
    return { sub, space: sub.metadata?.space }
  }
  // A checkout session names its subscription and carries the space we put on
  // it; an invoice names its subscription and nothing else. `parent` is where
  // the invoice's subscription moved in API 2025-03-31.basil, and the old
  // field is read too for the same reason `periodEnd` reads both.
  let parent = (o.parent ?? {}) as {
    subscription_details?: { subscription?: string | { id?: string } }
  }
  let named = idOf(
    (o.subscription as string | { id?: string } | undefined) ??
      parent.subscription_details?.subscription,
  )
  if (!named) return null
  let sub = await ask(env, `/v1/subscriptions/${named}`).catch((e) => {
    if (unseen(e, event)) return null
    throw e
  }) as Sub | null
  if (!sub) return 'elsewhere'
  return {
    sub,
    space: sub.metadata?.space ||
      (typeof o.client_reference_id == 'string' ? o.client_reference_id : '') ||
      (o.metadata as Record<string, string> | undefined)?.space,
  }
}

// One verified event, applied. Answers what it did, which is what the door
// says back — Stripe ignores the body, and a person reading the logs does not.
export let apply = async (env: Env, event: Event) => {
  let at = new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000)
    .toISOString()
  // Another deployment's purchase is its business, not a fault of ours, and it
  // is let go before a GET that our key may not even be able to answer.
  let here = apex(env)
  if (elsewhere(event.data?.object ?? {}, here)) return 'elsewhere'
  let subject = await subjectOf(env, event)
  if (!subject) return 'nothing to do'
  if (subject == 'elsewhere' || elsewhere(subject.sub, here)) return 'elsewhere'
  let next = planOf(subject.sub, at, organizationPrices(env))
  let dir = dirOf(env)
  let space = await whose(dir, {
    space: subject.space,
    customer: next.customer,
  })
  if (!space) {
    if (!lost(subject.sub, event.livemode, here)) return 'elsewhere'
    // Money changed hands and we cannot say whose it was. Nothing to retry —
    // a second delivery finds the same nothing — so it is filed where the
    // owner reads it and the door answers 200 rather than making Stripe repeat
    // an unanswerable question for three days.
    await fault(
      env,
      'POST /stripe/webhook',
      new Error(
        `${event.type}: no space owns subscription ${next.subscription} ` +
          `(customer ${next.customer})`,
      ),
    )
    return 'unattributed'
  }
  if (stale(space.plan, next)) return 'stale'
  let changed = moved(space.plan, next)
  if (!Object.keys(changed).length) return 'unchanged'
  await stamp(env, {
    entities: [{ entity: { eid: space.eid }, plan: changed }],
  })
  return `${space.slug} is ${next.tier}`
}

// Stripe's door. The body is read as text once and verified as that exact
// string: the signature covers the raw bytes, so parsing and re-serializing
// would verify something Stripe never signed.
//
// It carries no `Origin` — this is server to server — and route.ts
// `sameOrigin` allows an absent Origin deliberately, which is what lets a
// webhook through the guard that separates spaces (index.ts, T-33118). A
// silently 403'd webhook is a plan that never activates, so
// origin_test.ts holds that open on purpose.
let hook = async (env: Env, req: Request) => {
  if (req.method != 'POST') {
    return json(405, 'method_not_allowed', 'post the event here')
  }
  let raw = await req.text()
  if (!env.STRIPE_WEBHOOK_SECRET) {
    if (!hushed('unset')) {
      await fault(
        env,
        'POST /stripe/webhook',
        new Error('STRIPE_WEBHOOK_SECRET is not set — an event went unread'),
      )
    }
    return json(503, 'no_billing', 'this door is not switched on here')
  }
  let no = await refusal('stripe', env.STRIPE_WEBHOOK_SECRET, raw, req.headers)
  if (no) {
    if (ours(no) && !hushed(no)) {
      await fault(env, 'POST /stripe/webhook', new Error(no))
    }
    return json(400, 'bad_signature', no)
  }
  let event: Event
  try {
    event = JSON.parse(raw) as Event
  } catch {
    return json(400, 'bad_event', 'that was not an event')
  }
  // A failure past this line is ours, so it throws: index.ts files it and
  // answers a 5xx, and Stripe delivers again. That is exactly what we want for
  // a store that was busy or a Stripe call that timed out.
  return Response.json({ received: true, did: await apply(env, event) })
}

export let fetch = (req: Request, env: Env): Promise<Response> => {
  let path = new URL(req.url).pathname
  if (path == '/stripe/webhook') {
    return hook(env, req)
  }
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
