// What Stripe sells a party as @yaks/host's `Plans`: a customer minted once,
// a subscription bought through Checkout and managed in the customer portal,
// its trial moved to give time free, and the events Stripe posts about it
// read into the host's words (`changed`, which ./doors.ts hears them with).
//
// Checkout runs under Managed Payments: Stripe is the merchant of record, so
// it sells, collects and remits the tax, and the parameters it controls
// (automatic_tax, payment_method_types, tax_id_collection, customer_update,
// invoice_creation) must not be sent at all, so none of them appear below.
//
// Which tier a subscription buys is read off its price, never off metadata a
// checkout wrote: a plan changed in the portal moves the price and nothing
// else. A paying price no tier lists buys the first tier the options name, so
// a subscription made before a later tier existed reads as it did.
import type {
  Changed,
  Per,
  Plans,
  Standing,
  Subscription,
  Tags,
} from '@yaks/host/payments'
import { ask, type Keyed, StripeError } from './mod.ts'

/** What a config gives the plans: the key and clock every call is made with
 * (`Keyed`), and each tier's price ids by how often it is paid for, in the
 * order a price none lists falls back to the first of. */
export type Options = Keyed & {
  prices?: Record<string, Partial<Record<Per, string>>>
}

// The slice of a Stripe subscription read here. Everything is optional: the
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
  trial_end?: number | null
  current_period_end?: number | null
  items?: {
    data?: {
      current_period_end?: number | null
      price?: string | { id?: string } | null
    }[]
  }
}

// `past_due` keeps the plan on purpose: Stripe retries a failed card for days
// before it gives up, and taking somebody's apps away on the first decline is
// the wall T-32756 says not to build. When Stripe does give up the status
// becomes `canceled` or `unpaid`. Stripe never moves a subscription out of
// `canceled` or `incomplete_expired`, which is what makes `ended` final.
let STANDING: Record<string, Standing> = {
  active: 'paying',
  trialing: 'paying',
  past_due: 'owing',
  canceled: 'ended',
  incomplete_expired: 'ended',
}

/// standing('trialing') -> 'paying'
/// standing('unpaid') -> 'lapsed'
/** Where a subscription with this status stands. */
export let standing = (status: string): Standing =>
  Object.hasOwn(STANDING, status) ? STANDING[status] : 'lapsed'

let when = (unix?: number | null) =>
  unix == null ? null : new Date(unix * 1000).toISOString()

/** When the paid-for period runs out. The field moved off the subscription
 * onto each of its items in API version 2025-03-31.basil, and the webhook
 * endpoint pins no version of its own, so the version it sends can move under
 * us. Either shape is read: the latest item wins, since a subscription of
 * these has one item. */
export let periodEnd = (sub: Sub): number | null => {
  if (sub.current_period_end != null) return sub.current_period_end
  let ends = (sub.items?.data ?? [])
    .map((i) => i.current_period_end)
    .filter((n): n is number => typeof n == 'number')
  return ends.length ? Math.max(...ends) : null
}

let idOf = (v: string | { id?: string } | null | undefined) =>
  typeof v == 'string' ? v : v?.id ?? ''

/** The tier a subscription's price buys: the first of `prices` listing one of
 * its items' prices, else the first of `prices`. */
export let tierFor = (sub: Sub, prices: Options['prices'] = {}): string => {
  let tiers = Object.entries(prices)
  let bought = (sub.items?.data ?? []).map((i) => idOf(i.price))
  let found = tiers.find(([, by]) =>
    Object.values(by).some((p) => !!p && bought.includes(p))
  )
  return (found ?? tiers[0])?.[0] ?? ''
}

/** A Stripe subscription in the host's words. */
export let read = (sub: Sub, prices?: Options['prices']): Subscription => {
  let status = sub.status ?? ''
  let end = periodEnd(sub)
  // Set only when the subscription will not renew, so "cancelled, but paid
  // through the 14th" is one row to read: an explicit `cancel_at`, else the
  // period end it is riding out, else, for one already over, when it ended.
  let ends = sub.cancel_at ??
    (sub.cancel_at_period_end ? end : null) ??
    (standing(status) == 'ended'
      ? sub.ended_at ?? sub.canceled_at ?? end
      : null)
  return {
    id: sub.id ?? '',
    payer: idOf(sub.customer),
    tier: tierFor(sub, prices),
    status,
    until: when(end),
    ending: when(ends),
    tags: { ...sub.metadata },
  }
}

/** The trial a subscription bought while time given free runs starts with,
 * so the free time is kept and the first charge falls when it ends. Stripe
 * takes a trial ending no sooner than two days away, so one ending sooner is
 * two days. */
export let trialFor = (
  free: string | null | undefined,
  now: number,
): { trial_end?: number } =>
  free
    ? {
      trial_end: Math.floor(
        Math.max(Date.parse(free), now + 49 * 60 * 60_000) / 1000,
      ),
    }
    : {}

// What a Stripe object was tagged with: its own metadata, over the copy of
// its subscription's an invoice carries under `parent`.
let tagsOf = (o: Record<string, unknown>): Tags => {
  let parent = o.parent as
    | { subscription_details?: { metadata?: Tags } }
    | undefined
  return {
    ...parent?.subscription_details?.metadata,
    ...o.metadata as Tags | undefined,
  }
}

type Event = {
  type?: string
  created?: number
  livemode?: boolean
  data?: { object?: Record<string, unknown> }
}

let path = (subscription: string) =>
  `/v1/subscriptions/${encodeURIComponent(subscription)}`

/** Stripe's plans, every call made with `options` as they read at the
 * time. */
export let plans = (options: Options): Plans => {
  let now = () => options.clock?.now() ?? Date.now()
  let price = (tier: string, per: Per) => options.prices?.[tier]?.[per]
  let fetched = (id: string) =>
    ask(options, path(id)).then(
      (sub) => sub as Sub,
      (e) => {
        if (e instanceof StripeError && e.code == 'resource_missing') {
          return null
        }
        throw e
      },
    )
  let subscription = async (id: string) => {
    let sub = await fetched(id)
    return sub && read(sub, options.prices)
  }
  let charges = async (id: string) => {
    let sub = await ask(options, path(id)) as Sub
    let end = Math.max(sub.trial_end ?? 0, periodEnd(sub) ?? 0)
    return end ? new Date(end * 1000).toISOString() : null
  }
  return {
    on: () => !!options.key,
    offers: (tier, per) => !!options.key && !!price(tier, per),
    standing,
    payer: async ({ email, name, tags }) => {
      let made = await ask(options, '/v1/customers', {
        email,
        name,
        metadata: tags,
      })
      let customer = String(made.id ?? '')
      if (!customer) throw new Error('stripe made a customer with no id')
      return customer
    },
    billed: async (payer) => {
      let c = await ask(options, `/v1/customers/${encodeURIComponent(payer)}`)
      return c.deleted
        ? null
        : { email: String(c.email ?? ''), name: String(c.name ?? '') }
    },
    checkout: async (asked) => {
      let bought = price(asked.tier, asked.per)
      if (!bought) {
        throw new Error(
          `stripe has no price for ${asked.tier} by the ${asked.per}`,
        )
      }
      // Everything here survives Managed Payments, verified against the
      // account rather than assumed: the reference rides
      // `client_reference_id` for the session and the tags ride
      // `subscription_data[metadata]` for the subscription, which every later
      // `customer.subscription.*` event is read by. `allow_promotion_codes`
      // puts the code box on Stripe's page, the only place one belongs, since
      // Stripe is the seller and owns the price it charges.
      let made = await ask(options, '/v1/checkout/sessions', {
        mode: 'subscription',
        customer: asked.payer,
        line_items: { 0: { price: bought, quantity: 1 } },
        success_url: asked.done,
        cancel_url: asked.cancel,
        client_reference_id: asked.reference,
        metadata: asked.tags,
        subscription_data: {
          metadata: asked.tags,
          ...trialFor(asked.trial, now()),
        },
        managed_payments: { enabled: true },
        allow_promotion_codes: true,
      })
      let url = String(made.url ?? '')
      if (!url) throw new Error('stripe made a checkout session with no url')
      return url
    },
    // The portal needs a configuration on the account; without one Stripe
    // refuses, and the refusal throws.
    portal: async (payer, back) => {
      let made = await ask(options, '/v1/billing_portal/sessions', {
        customer: payer,
        return_url: back,
      })
      let url = String(made.url ?? '')
      if (!url) throw new Error('stripe made a portal session with no url')
      return url
    },
    subscription,
    charges,
    // The trial set to end then, prorating nothing.
    postpone: async (id, until) => {
      let next = await charges(id)
      if (next && Date.parse(next) >= Date.parse(until)) return
      await ask(options, path(id), {
        trial_end: Math.floor(Date.parse(until) / 1000),
        proration_behavior: 'none',
      })
    },
  }
}

/** A verified event Stripe posted to the platform's own endpoint, read: a
 * `customer.subscription.*` event carries its subscription whole, and a
 * checkout session or an invoice names it, which one GET answers. An
 * invoice's name for it moved under `parent` in API 2025-03-31.basil, and the
 * old field is read too, for the reason `periodEnd` reads both. */
export let changed = (options: Options) => (event: unknown): Changed => {
  let e = (event ?? {}) as Event
  let o = e.data?.object ?? {}
  let reference = o.client_reference_id
  let parent = (o.parent ?? {}) as {
    subscription_details?: { subscription?: string | { id?: string } }
  }
  let named = idOf(
    (o.subscription as string | { id?: string } | undefined) ??
      parent.subscription_details?.subscription,
  )
  let now = options.clock?.now() ?? Date.now()
  return {
    about: 'subscription',
    at: new Date((e.created ?? Math.floor(now / 1000)) * 1000).toISOString(),
    live: e.livemode !== false,
    tags: tagsOf(o),
    ...typeof reference == 'string' && reference ? { reference } : {},
    subscription: () =>
      (e.type ?? '').startsWith('customer.subscription.')
        ? Promise.resolve(read(o as Sub, options.prices))
        : named
        ? plans(options).subscription(named)
        : Promise.resolve(undefined),
  }
}
