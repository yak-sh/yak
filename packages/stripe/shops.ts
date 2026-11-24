// What Stripe lends a party selling on an account of its own, as @yaks/host's
// `Shops`: a Connect account opened once, finished through Stripe's hosted
// onboarding, Checkout Sessions on it that the platform takes an application
// fee from, in payment mode or in subscription mode, the subscriptions those
// start, read and cancelled at their period's end, and the events Stripe
// posts about it read into the host's words (`shopped`, which ./doors.ts
// hears them with).
//
// Direct charges throughout, the "charge merchants directly" model. The
// connected account is the merchant: the charge is on their books, Stripe's
// processing fee comes out of their money, the customer's statement says their
// name, and a refund or a dispute is theirs to answer and theirs to pay. The
// platform acts on their account with its own key, one `Stripe-Account` header
// (./mod.ts `ask`), and names an `application_fee_amount` Stripe moves to it
// out of the same payment.
//
// A seller who already has a Stripe account connects it instead, through
// Connect's OAuth for Standard accounts (docs.stripe.com/connect/oauth-standard-accounts):
// Stripe's page asks them to sign in and allow the platform, and hands them
// back with a code the platform trades for the account's id. Stripe calls
// OAuth not recommended for new platforms because Account Links onboard an
// account the platform makes; it remains the one way to connect an account
// that already exists. The account is theirs, not the platform's to
// control, so its details are changed in their own dashboard, and the same
// direct charges and application fee apply to it.
//
// The house sells on the platform's own account instead (@yaks/host/payments
// `Seller`), named '' wherever an account is: the same calls with no
// `Stripe-Account` header, so the charge is the platform's, Stripe's fees come
// out of the platform's balance (and its fee credit), and no application fee
// is named, since Stripe takes none from an account for itself. Managed
// Payments, on by default on the platform's account for its plans, is turned
// off for these: it sells digital goods as merchant of record, and the house
// sells printed books as itself. The card statement reads the platform's
// prefix and the seller's name after it (`YAKS.APP* PRINTBOUND`). Its events
// arrive at the platform's own endpoint, which `housed` tells from the
// platform's own plans.
//
// v1 throughout, deliberately: `POST /v1/accounts` with controller properties,
// and the v1 event names. There is a v2 Accounts API with its own thin
// `v2.core.*` events; mixing the two would mean a reader of one set of names
// and a dashboard ticking the other, which is a webhook that silently does
// nothing.
import type {
  Paid,
  Sale,
  Seller,
  Settled,
  Shopped,
  Shops,
  Tags,
  Term,
} from '@yaks/host/payments'
import { ask, found, idOf, type Keyed } from './mod.ts'
import { refund, refundedOf } from './refunds.ts'
import {
  ending,
  periodEnd,
  periodStart,
  standing,
  type Sub,
  when,
} from './plans.ts'

/** The slice of a Stripe account read here. Optional throughout: the shape is
 * Stripe's to move, and a field that went missing must leave a readable row
 * rather than a throw in the middle of somebody's onboarding. */
export type Account = {
  id?: string
  charges_enabled?: boolean
  details_submitted?: boolean
  payouts_enabled?: boolean
  /** `is_controller` true for an account the platform made; unset for one
   * a seller connected */
  controller?: { is_controller?: boolean }
}

/** Stripe's host for Connect's OAuth, and where a seller whose account the
 * platform does not control changes its details: their own dashboard. */
export let CONNECT = 'https://connect.stripe.com'
export let DASHBOARD = 'https://dashboard.stripe.com/'

/** What the shops are lent: the key and clock, and the platform's Connect
 * `client_id` (ca_…), which a seller connects an account they already have
 * through; without one they can only open a new one. */
export type Options = Keyed & { client?: string }

/// authorizeAt('ca_1', 's1', 'https://yaks.app/selling/callback') -> 'https://connect.stripe.com/oauth/authorize?response_type=code&client_id=ca_1&scope=read_write&state=s1&redirect_uri=https%3A%2F%2Fyaks.app%2Fselling%2Fcallback'
/** The address of Stripe's page where a seller connects an account they
 * already have. `read_write` is the only scope a platform may ask for, and
 * `redirect_uri` must be one listed in the platform's OAuth settings. */
export let authorizeAt = (client: string, state: string, back: string) =>
  `${CONNECT}/oauth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: client,
    scope: 'read_write',
    state,
    redirect_uri: back,
  })}`

/** The slice of a completed Checkout Session read here. */
export type Session = {
  id?: string
  payment_intent?: string | { id?: string }
  payment_status?: string
  amount_total?: number
  currency?: string
  customer_email?: string | null
  customer_details?: { email?: string | null }
  metadata?: Record<string, string>
  /** the one it started, in subscription mode */
  subscription?: string | { id?: string } | null
}

/** The slice of a charge, or of a dispute about one, read here. */
export type Charge = {
  id?: string
  /** a dispute's charge */
  charge?: string | { id?: string }
  payment_intent?: string | { id?: string }
  metadata?: Record<string, string>
  refunded?: boolean
  amount?: number
  amount_refunded?: number
  application_fee?: string | { id?: string }
  status?: string
}

/**
 * The account asked for, as the form fields of `POST /v1/accounts`.
 *
 * The controller properties are the whole model. "Charge merchants directly"
 * is these four answers, and each is a sentence about who is responsible for
 * what. They are also, all four, Stripe's own defaults, the combination it
 * documents as the Standard mapping
 * (docs.stripe.com/connect/migrate-to-controller-properties). They are written
 * out anyway, because a liability decision that four omitted parameters happen
 * to make is a liability decision nobody can read, and a default Stripe moves
 * one day would move it silently.
 *
 *   `controller[fees][payer] = account`
 *       the connected account pays Stripe's processing fee, out of its own
 *       money, on its own charge. Not the platform: it is not reselling
 *       payments.
 *   `controller[losses][payments] = stripe`
 *       Stripe, not the platform, carries the negative balance when a dispute
 *       is lost. There is no `account` value here and the value is not a
 *       mistake: `stripe` is what "the platform is not liable" is called, and
 *       the merchant is still the one whose charge is reversed.
 *   `controller[stripe_dashboard][type] = full`
 *       the seller gets the whole Stripe Dashboard, their own account, where
 *       they read their payments, answer their disputes and manage their
 *       payouts. `express` is the cut-down one, and Stripe refuses it beside
 *       `fees.payer = account`: an Express dashboard is for a platform that
 *       pays the fees and carries the losses, which is the opposite of this.
 *   `controller[requirement_collection] = stripe`
 *       Stripe collects and re-collects the identity requirements, through the
 *       Account Link below. The platform never sees, stores or forwards a
 *       seller's identity documents, which is exactly the property that lets
 *       this integration exist without it becoming a KYC operator.
 *
 * No `capabilities`, deliberately. Stripe requires them only where the account
 * has no Stripe-hosted dashboard; with `full` the payment capabilities are
 * requested automatically for the account's country, and the seller manages
 * them themselves. `transfers` in particular would be wrong: that is the
 * capability a destination charge needs, and a direct charge never transfers.
 *
 * No `type` either. It is deprecated in favour of exactly these four
 * properties, and the two ways of saying one thing are not passed together.
 *
 * `metadata` carries the tags, so an account read back out of Stripe's
 * dashboard says whose it is without a lookup.
 */
export let account = (who: { email?: string; tags: Tags }) => ({
  controller: {
    fees: { payer: 'account' },
    losses: { payments: 'stripe' },
    stripe_dashboard: { type: 'full' },
    requirement_collection: 'stripe',
  },
  ...(who.email ? { email: who.email } : {}),
  metadata: who.tags,
})

/** The onboarding link, as the form fields of `POST /v1/account_links`.
 *
 * `account_onboarding` and never `account_update`: Stripe refuses an update
 * link for an account that has its own dashboard, and these all do. A seller
 * changing their details later does it in their own Stripe Dashboard, which is
 * the whole point of giving them one.
 *
 * `return_url` is where Stripe sends them when they finish, and `refresh_url`
 * where it sends them when the link is spent: an Account Link is single-use
 * and expires in about five minutes, since it is an authenticated door into
 * somebody's identity form. Stripe's own instruction for `refresh_url` is
 * "generate a new account link with the same parameters, then redirect", which
 * is asking for onboarding again, so both are `back`. */
export let link = (account: string, back: string) => ({
  account,
  type: 'account_onboarding',
  return_url: back,
  refresh_url: back,
})

/** A Stripe account as a seller: `charges_enabled` is `ready` and
 * `details_submitted` is `submitted`.
 *
 * A missing field reads false rather than "unchanged". Stripe sends the whole
 * account object on every `account.updated`, so an absent flag is an absent
 * capability, and a reader that treated it as unchanged would leave a seller
 * marked ready after Stripe stopped them. */
export let sellerOf = (a: Account): Seller => ({
  account: String(a.id ?? ''),
  ready: !!a.charges_enabled,
  submitted: !!a.details_submitted,
})

/** The longest metadata value Stripe keeps, in characters: the most one
 * tag carries ({@link Shops.tag}). */
export let TAG = 500

/** A return address as Stripe reads it. `{CHECKOUT_SESSION_ID}` is a literal
 * Stripe substitutes the session id for on the way back, and the host hands
 * over an address `URL` wrote, which percent-encodes braces in a query:
 * `%7BCHECKOUT_SESSION_ID%7D` is a string Stripe does not recognise, so the
 * buyer would land on a page that never learns which order it is about. The
 * braces come back, and only those two characters. */
export let back = (url: string): string =>
  url.replaceAll('%7B', '{').replaceAll('%7D', '}')

/// cut({ lines: [{ name: 'Tee', cents: 999, qty: 1 }], bps: 250 }) -> 24
/// cut({ lines: [{ name: 'Tee', cents: 100, qty: 1 }], bps: 20_000 }) -> 100
/** The platform's cut of a sale paid once, in its smallest unit: the rate of
 * its whole total, shipping included, rounded down, and never more than the
 * sale. */
export let cut = (sale: Pick<Sale, 'lines' | 'shipping' | 'bps'>): number => {
  let total = sale.lines.reduce((n, l) => n + l.cents * l.qty, 0) +
    (sale.shipping?.cents ?? 0)
  return Math.min(
    total,
    Math.max(0, Math.floor(total * (sale.bps || 0) / 10_000)),
  )
}

// The payment a sale paid once makes. `application_fee_amount` is the
// platform's cut, and this is the only place Stripe takes one for a payment
// Checkout Session: there is no top-level parameter. It is left out entirely
// when it is zero, since Stripe requires a positive amount, so a fee of
// nothing has to be no fee rather than a fee of 0.
//
// The tags are copied onto it, which is not redundancy: a refund arrives as a
// `charge.refunded`, whose object inherits the PaymentIntent's metadata and
// knows nothing of the session, so without them the refund of a sale could
// not be told whose it was.
let once = (sale: Sale, house: boolean) => {
  let fee = house ? 0 : cut(sale)
  let suffix = house && sale.descriptor ? descriptor(sale.descriptor) : ''
  return {
    ...(house ? { managed_payments: { enabled: false } } : {}),
    ...(sale.shipping
      ? {
        shipping_options: [{
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: sale.shipping.name,
            fixed_amount: {
              amount: sale.shipping.cents,
              currency: sale.currency,
            },
          },
        }],
      }
      : {}),
    payment_intent_data: {
      ...(fee > 0 ? { application_fee_amount: fee } : {}),
      ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
      metadata: house ? marked(sale.tags) : sale.tags,
      ...(sale.destination ? { shipping: sale.destination } : {}),
    },
  }
}

// The subscription a renewing sale makes. Its fee is a percent of every
// invoice, since an amount would be taken from the first payment alone, and a
// rate in whole basis points is a percent with the two decimal places Stripe
// takes. The tags ride the subscription, which every `customer.subscription.*`
// event carries back, and which an invoice's payment does not inherit.
let renewing = (sale: Sale) => ({
  subscription_data: {
    ...(sale.bps > 0
      ? { application_fee_percent: Math.min(100, sale.bps / 100) }
      : {}),
    metadata: sale.tags,
  },
})

/// descriptor('PrintBound') -> 'PRINTBOUND'
/// descriptor('Crayon "Bloom" <Books>') -> 'CRAYON BLOOM BOOKS'
/// descriptor('1234') -> ''
/** A seller's name as a statement descriptor suffix: upper case, without the
 * characters Stripe refuses there (`<>\'"*`), at most 22 characters, and ''
 * where no letter is left, which Stripe requires one of. Stripe itself cuts
 * the suffix to what fits after the account's prefix. */
export let descriptor = (name: string): string => {
  let out = name.toUpperCase().replace(/[<>\\'"*]/g, '').replace(/\s+/g, ' ')
    .trim().slice(0, 22).trim()
  return /\p{L}/u.test(out) ? out : ''
}

/** The metadata key a house sale's objects carry, which tells its events on
 * the platform's own account from the platform's plans (`housed`). */
export let HOUSE = 'house'

let marked = (tags: Tags): Tags => ({ ...tags, [HOUSE]: 'true' })

/**
 * The Checkout Session, as the form fields of `POST /v1/checkout/sessions`,
 * made on the seller's account (the `Stripe-Account` header `checkout` adds),
 * or on the platform's own for the house: in payment mode for a sale paid
 * once, and in subscription mode for one that says how often it renews, where
 * every line recurs at that interval.
 *
 * The tags ride `metadata`, and the payment or the subscription it makes as
 * well, with the house's mark on a house sale. Lines go out as inline
 * `price_data`, numbered as Stripe's form encoding numbers a list.
 */
export let session = (sale: Sale, house = false): Record<string, unknown> => ({
  mode: sale.per ? 'subscription' : 'payment',
  ...(sale.expires
    ? { expires_at: Math.floor(Date.parse(sale.expires) / 1000) }
    : {}),
  line_items: Object.fromEntries(sale.lines.map((l, i) => [i, {
    price_data: {
      currency: sale.currency,
      product_data: { name: l.name },
      unit_amount: l.cents,
      ...(sale.per ? { recurring: { interval: sale.per } } : {}),
    },
    quantity: l.qty,
  }])),
  success_url: back(sale.done),
  cancel_url: back(sale.cancel),
  ...(sale.email ? { customer_email: sale.email } : {}),
  metadata: house ? marked(sale.tags) : sale.tags,
  ...(sale.per ? renewing(sale) : once(sale, house)),
})

/** A completed session as the sale it made. The buyer's address is
 * `customer_details.email` and only falls back to `customer_email`: the
 * second is the prefill the checkout started with, and the person may have
 * typed a different one on Stripe's page. `payment_status` is the gate and
 * `status` is not: a session can be `complete` with a payment still
 * processing (a bank debit, say), and `paid` is the word Stripe documents as
 * "the funds are available". */
export let paidOf = (o: Session): Paid => ({
  ...(o.currency ? { currency: o.currency } : {}),
  paid: o.payment_status == 'paid',
  status: String(o.payment_status ?? ''),
  checkout: String(o.id ?? ''),
  payment: idOf(o.payment_intent),
  ...(idOf(o.subscription) ? { subscription: idOf(o.subscription) } : {}),
  total: Math.max(0, Math.floor(Number(o.amount_total ?? 0))),
  email: String(o.customer_details?.email || o.customer_email || ''),
  tags: { ...o.metadata },
})

/** When what a subscription was paid for runs out, in Stripe's seconds.
 * While it renews, or while Stripe retries a failed charge (`past_due`, which
 * keeps it as ./plans.ts keeps a plan), that is the period's end. One that
 * never paid has none. One that lapsed unpaid was paid up to the period it
 * failed to pay, and one that ended stopped when it ended, which for one
 * cancelled at its period's end is that end. */
export let paidThrough = (sub: Sub): number | null => {
  let status = sub.status ?? ''
  if (status == 'incomplete' || status == 'incomplete_expired') return null
  let stands = standing(status)
  return stands == 'paying' || stands == 'owing'
    ? periodEnd(sub)
    : stands == 'ended'
    ? sub.ended_at ?? sub.canceled_at ?? periodEnd(sub)
    : periodStart(sub)
}

/** A subscription on a seller's account as the term it is paid for. */
export let termOf = (sub: Sub): Term => ({
  id: String(sub.id ?? ''),
  until: when(paidThrough(sub)),
  ending: ending(sub, sub.status ?? ''),
  tags: { ...sub.metadata },
})

// Where an event moves a payment. A refund is whole only once the whole charge
// is (Stripe's `refunded`). A dispute is open until it closes: `lost` means
// the buyer's bank took the money back, and `won` or an inquiry closed without
// one (`warning_closed`) restores it. A dispute's other events (updated, funds
// withdrawn or reinstated) move nothing.
let settledBy = (type: string, o: Charge): Settled | null =>
  type == 'charge.refunded'
    ? o.refunded ? 'refunded' : 'partially_refunded'
    : type == 'charge.dispute.created'
    ? 'disputed'
    : type == 'charge.dispute.closed'
    ? o.status == 'lost' ? 'lost' : 'restored'
    : null

type Event = {
  type?: string
  account?: string
  data?: { object?: Record<string, unknown> }
}

let subscription = (id: string) => `/v1/subscriptions/${encodeURIComponent(id)}`

// A subscription on a seller's account as it stands.
let termAt = async (options: Keyed, on: string, id: string) => {
  let sub = await found(options, subscription(id), on) as Sub | null
  return sub && termOf(sub)
}

/** Stripe's shops, every call made with `options` as they read at the
 * time. */
export let shops = (options: Options): Shops => {
  // The address of what one POST made, which Stripe always answers with.
  let made = async (
    what: string,
    path: string,
    fields: Record<string, unknown>,
    on?: string,
    key?: string,
  ) => {
    let url = String(
      (await ask(options, path, fields, on, 'POST', key)).url ?? '',
    )
    if (!url) throw new Error(`stripe made ${what} with no url`)
    return url
  }
  return {
    on: () => !!options.key,
    tag: TAG,
    open: async (who) => {
      let a = await ask(options, '/v1/accounts', account(who)) as Account
      if (!a.id) throw new Error('stripe made an account with no id')
      return sellerOf(a)
    },
    // An account the seller brought is not ours to onboard: Stripe makes no
    // Account Link for it, and its owner finishes in their own dashboard.
    onboarding: async (id, back) => {
      let a = await ask(options, `/v1/accounts/${encodeURIComponent(id)}`)
      return (a as Account).controller?.is_controller
        ? await made('an account link', '/v1/account_links', link(id, back))
        : DASHBOARD
    },
    authorize: (state, back) =>
      options.client ? authorizeAt(options.client, state, back) : null,
    // The code is good once, so the trade is never retried under a new key.
    authorized: async (code) => {
      let token = await ask(
        options,
        `${CONNECT}/oauth/token`,
        { grant_type: 'authorization_code', code },
        undefined,
        'POST',
        `oauth:${code}`,
      )
      let id = String(token.stripe_user_id ?? '')
      if (!id) throw new Error('stripe connected an account with no id')
      return sellerOf(
        await ask(options, `/v1/accounts/${encodeURIComponent(id)}`) as Account,
      )
    },
    // On the seller's account: that one header is the whole of what makes it
    // their charge rather than the platform's. The house's has none, and
    // sells nothing that renews: a subscription's events on the platform's
    // own account are read as the platform's plans.
    checkout: (on, sale) => {
      if (!on && sale.per) {
        throw new Error('the house sells nothing that renews')
      }
      return made(
        'a checkout session',
        '/v1/checkout/sessions',
        session(sale, !on),
        on,
        sale.key,
      )
    },
    paid: async (on, checkout) => {
      let o = await found(
        options,
        `/v1/checkout/sessions/${encodeURIComponent(checkout)}`,
        on,
      )
      return o && paidOf(o as Session)
    },
    term: (on, id) => termAt(options, on, id),
    // `cancel_at_period_end` and not a delete: the buyer keeps what they paid
    // for, and Stripe ends it when the period does. Setting it twice is one
    // setting, so no request key holds it: one would replay a stale answer
    // to a cancel asked again after the seller undid the first.
    cancel: async (on, id) =>
      termOf(
        await ask(
          options,
          subscription(id),
          { cancel_at_period_end: true },
          on,
        ) as Sub,
      ),
    refund: (on, request) => refund(options, on, request),
    refundFee: async (id, refunded, total) => {
      if (!total || !refunded) return
      let fee = await ask(
        options,
        `/v1/application_fees/${encodeURIComponent(id)}`,
      )
      let target = Math.floor(
        Number(fee.amount ?? 0) * Math.min(refunded, total) / total,
      )
      let amount = target - Number(fee.amount_refunded ?? 0)
      if (amount <= 0) return
      await ask(
        options,
        `/v1/application_fees/${encodeURIComponent(id)}/refunds`,
        { amount },
        undefined,
        'POST',
        `fee:${id}:${refunded}:${total}`,
      )
    },
  }
}

// A charge's payment and what it carries: a charge inherits its intent's
// metadata, and is read back on the seller's own account for a dispute, which
// carries none of its own.
let payment = (o: Charge) => {
  let id = idOf(o.payment_intent)
  return id
    ? {
      id,
      tags: { ...o.metadata },
      ...(o.amount != null ? { total: o.amount } : {}),
      ...(o.amount_refunded != null ? { refunded: o.amount_refunded } : {}),
      ...(idOf(o.application_fee) ? { fee: idOf(o.application_fee) } : {}),
    }
    : null
}

// The subscription an event moves the term of, '' where it names none, and
// null for an event about no subscription's term. A subscription's own events
// say it was made, renewed, cancelled or ended; an invoice paid is a period
// paid for, and names its subscription under `parent` since API
// 2025-03-31.basil and at its top level before (as ./plans.ts `changed`
// reads it). Every one is read again from Stripe when it is applied, so the
// order they arrive in leaves the latest word.
let subscribedBy = (type: string, o: Record<string, unknown>) => {
  if (type.startsWith('customer.subscription.')) {
    return idOf(o.id as string | undefined)
  }
  if (type != 'invoice.paid') return null
  let parent = o.parent as
    | { subscription_details?: { subscription?: string | { id?: string } } }
    | undefined
  return idOf(
    (o.subscription as string | { id?: string } | undefined) ??
      parent?.subscription_details?.subscription,
  )
}

/** Whether a verified event Stripe posted about the platform's own account is
 * about a house sale, which `shopped` reads, rather than about the platform's
 * plans, which ./plans.ts `changed` reads: a checkout carrying the house's
 * mark, or a payment refunded or disputed. The platform's plans read neither
 * of the second, and a refund or dispute of one of theirs reads as a payment
 * the shops know nothing of. */
export let housed = (event: unknown): boolean => {
  let e = (event ?? {}) as Event
  let type = e.type ?? ''
  return type == 'checkout.session.completed'
    ? (e.data?.object?.metadata as Tags | undefined)?.[HOUSE] == 'true'
    : type == 'charge.refunded' || type.startsWith('charge.dispute.') ||
      type.startsWith('refund.')
}

/** A verified event Stripe posted to the Connect endpoint, read, with the
 * account it happened on: '' for one about a house sale, posted to the
 * platform's own endpoint. */
export let shopped = (options: Keyed) => (event: unknown): Shopped => {
  let e = (event ?? {}) as Event
  let type = e.type ?? ''
  let account = e.account ?? ''
  let o = e.data?.object ?? {}
  if (type == 'account.updated') {
    return { account, about: 'seller', seller: sellerOf(o as Account) }
  }
  if (type == 'account.application.deauthorized') {
    return { account, about: 'revoked' }
  }
  if (type == 'checkout.session.completed') {
    return { account, about: 'sale', sale: paidOf(o as Session) }
  }
  let renewed = subscribedBy(type, o)
  if (renewed != null) {
    return {
      account,
      about: 'term',
      term: async () =>
        renewed ? await termAt(options, account, renewed) : null,
    }
  }
  if (
    type == 'refund.created' || type == 'refund.updated' ||
    type == 'refund.failed'
  ) {
    return { account, about: 'refund', refund: refundedOf(o) }
  }
  let c = o as Charge
  let to = settledBy(type, c)
  if (!to) return { account, about: 'other' }
  return {
    account,
    about: 'payment',
    to,
    payment: async () => {
      if (type == 'charge.refunded') return payment(c)
      let charge = idOf(c.charge)
      if (!charge) return null
      return payment(
        await ask(
          options,
          `/v1/charges/${encodeURIComponent(charge)}`,
          undefined,
          account,
        ) as Charge,
      )
    },
  }
}
