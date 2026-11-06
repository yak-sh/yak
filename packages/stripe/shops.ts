// What Stripe lends a party selling on an account of its own, as @yaks/host's
// `Shops`: a Connect account opened once, finished through Stripe's hosted
// onboarding, Checkout Sessions on it that the platform takes an application
// fee from, and the events Stripe posts about it read into the host's words
// (`shopped`, which ./doors.ts hears them with).
//
// Direct charges throughout, the "charge merchants directly" model. The
// connected account is the merchant: the charge is on their books, Stripe's
// processing fee comes out of their money, the customer's statement says their
// name, and a refund or a dispute is theirs to answer and theirs to pay. The
// platform acts on their account with its own key, one `Stripe-Account` header
// (./mod.ts `ask`), and names an `application_fee_amount` Stripe moves to it
// out of the same payment.
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
} from '@yaks/host/payments'
import { ask, type Keyed } from './mod.ts'

/** The slice of a Stripe account read here. Optional throughout: the shape is
 * Stripe's to move, and a field that went missing must leave a readable row
 * rather than a throw in the middle of somebody's onboarding. */
export type Account = {
  id?: string
  charges_enabled?: boolean
  details_submitted?: boolean
  payouts_enabled?: boolean
}

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
}

/** The slice of a charge, or of a dispute about one, read here. */
export type Charge = {
  id?: string
  /** a dispute's charge */
  charge?: string | { id?: string }
  payment_intent?: string | { id?: string }
  metadata?: Record<string, string>
  refunded?: boolean
  status?: string
}

let idOf = (v: string | { id?: string } | undefined | null) =>
  typeof v == 'string' ? v : v?.id ?? ''

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
export let back = (url: string) =>
  url.replaceAll('%7B', '{').replaceAll('%7D', '}')

/**
 * The Checkout Session, as the form fields of `POST /v1/checkout/sessions`,
 * made on the seller's account (the `Stripe-Account` header `checkout` adds).
 *
 * `payment_intent_data[application_fee_amount]` is the platform's cut, and it
 * is the only place Stripe takes one for a Checkout Session: there is no
 * top-level parameter. It is left out entirely when it is zero, since Stripe
 * requires a positive amount, so a fee of nothing has to be no fee rather than
 * a fee of 0.
 *
 * Stripe does not give an application fee back when the charge it came out
 * of is refunded, so a seller who refunds from their own dashboard is out of
 * pocket by the platform's fee. Giving it back in proportion is
 * `POST /v1/application_fees/<id>/refund` (in part with `amount`), which these
 * shops would lend the day the host's TODO about it (sell.ts `settled`) is
 * built.
 *
 * The tags ride `metadata`, and are copied onto `payment_intent_data[metadata]`
 * as well, which is not redundancy: a refund arrives as a `charge.refunded`,
 * whose object inherits the PaymentIntent's metadata and knows nothing of the
 * session, so without this the refund of a sale could not be told whose it
 * was. Lines go out as inline `price_data`, numbered as Stripe's form encoding
 * numbers a list.
 */
export let session = (sale: Sale) => ({
  mode: 'payment',
  line_items: Object.fromEntries(sale.lines.map((l, i) => [i, {
    price_data: {
      currency: sale.currency,
      product_data: { name: l.name },
      unit_amount: l.cents,
    },
    quantity: l.qty,
  }])),
  success_url: back(sale.done),
  cancel_url: back(sale.cancel),
  ...(sale.email ? { customer_email: sale.email } : {}),
  metadata: sale.tags,
  payment_intent_data: {
    ...(sale.fee > 0 ? { application_fee_amount: sale.fee } : {}),
    metadata: sale.tags,
  },
})

/** A completed session as the sale it made. The buyer's address is
 * `customer_details.email` and only falls back to `customer_email`: the
 * second is the prefill the checkout started with, and the person may have
 * typed a different one on Stripe's page. `payment_status` is the gate and
 * `status` is not: a session can be `complete` with a payment still
 * processing (a bank debit, say), and `paid` is the word Stripe documents as
 * "the funds are available". */
export let paidOf = (o: Session): Paid => ({
  paid: o.payment_status == 'paid',
  status: String(o.payment_status ?? ''),
  checkout: String(o.id ?? ''),
  payment: idOf(o.payment_intent),
  total: Math.max(0, Math.floor(Number(o.amount_total ?? 0))),
  email: String(o.customer_details?.email || o.customer_email || ''),
  tags: { ...o.metadata },
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

/** Stripe's shops, every call made with `options` as they read at the
 * time. */
export let shops = (options: Keyed): Shops => {
  // The address of what one POST made, which Stripe always answers with.
  let made = async (
    what: string,
    path: string,
    fields: Record<string, unknown>,
    on?: string,
  ) => {
    let url = String((await ask(options, path, fields, on)).url ?? '')
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
    onboarding: (id, back) =>
      made('an account link', '/v1/account_links', link(id, back)),
    // On the seller's account: that one header is the whole of what makes it
    // their charge rather than the platform's.
    checkout: (on, sale) =>
      made('a checkout session', '/v1/checkout/sessions', session(sale), on),
  }
}

// A charge's payment and what it carries: a charge inherits its intent's
// metadata, and is read back on the seller's own account for a dispute, which
// carries none of its own.
let payment = (o: Charge) => {
  let id = idOf(o.payment_intent)
  return id ? { id, tags: { ...o.metadata } } : null
}

/** A verified event Stripe posted to the Connect endpoint, read, with the
 * account it happened on. */
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
