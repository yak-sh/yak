/** What a payment provider lends a host that takes money through it (the
 * lending kind `payments`, ./lending.ts): its name, for the sentences people
 * read, the plans it sells a party, the shops a party sells through on an
 * account of its own, and the webhook doors it hears both at. Each is
 * functions over the provider's own wire, answering in words that name no
 * provider, so a host's billing keeps its rules and refusals and a second
 * provider has one contract to meet. */

/** One line of a cart: which product, how many, and its variant. */
export type Item = { product: string; qty: number; options?: string }

/** The items as they ride the checkout and come back on the event: the product,
 * how many, and the variant, in the shortest form that survives a round
 * trip. They ride one tag, so its length is what decides how many lines fit
 * in an order. Dashes come off the uuid to buy back four
 * characters a line: a uuid without them is 32 characters and a line about
 * 45. */
export let packed = (items: Item[]): string =>
  JSON.stringify(
    items.map((i) => ({
      p: i.product.replace(/-/g, ''),
      q: i.qty,
      ...(i.options ? { o: i.options } : {}),
    })),
  )

/** The cart read back out of a checkout's tags — {@link packed}, undone.
 * Junk answers an empty list rather than throwing: an order whose items cannot
 * be read is still an order somebody paid for, and losing the money over the
 * label would be the worse mistake. */
export let unpacked = (items: unknown): Item[] => {
  try {
    let out = JSON.parse(String(items ?? '[]')) as {
      p?: string
      q?: number
      o?: string
    }[]
    return (Array.isArray(out) ? out : []).map((i) => ({
      product: String(i.p ?? '').replace(
        /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
        '$1-$2-$3-$4-$5',
      ),
      qty: Number(i.q ?? 1),
      ...(i.o ? { options: String(i.o) } : {}),
    }))
  } catch {
    return []
  }
}

/** A party's details and tags as a payer is minted with them, and what every
 * object the provider makes for that party carries back: the host's own
 * words, such as whose it is and where it was bought. */
export type Tags = Record<string, string>

/** How often a plan is paid for. */
export type Per = 'month' | 'year'

/** Where a subscription stands, as its provider reads its status: `paying`
 * and billed as it should be, `owing` still held while a failed charge is
 * retried, `awaiting` made but not yet paid for the first time, `lapsed` no
 * longer paid for though it may be again, `ended` over for good, which no
 * later word of the provider undoes. Only `paying` and `owing` hold a plan. */
export type Standing = 'paying' | 'owing' | 'awaiting' | 'lapsed' | 'ended'

/** A subscription as its provider reads it. */
export type Subscription = {
  id: string
  /** the payer it bills */
  payer: string
  /** the tier its price buys, one of those the provider was configured to
   * sell, whatever it stands at */
  tier: string
  /** How often the subscription bills, where the provider names it. */
  per?: Per
  /** the provider's own word for where it stands ({@link Plans.standing}) */
  status: string
  /** when the period paid for runs out */
  until: string | null
  /** set only when it will not renew: when it stops, or stopped */
  ending: string | null
  /** what it was bought with ({@link Checkout.tags}) */
  tags: Tags
}

/** A hosted checkout for a plan: where to send the person, and what it
 * subscribes them to. */
export type Checkout = {
  payer: string
  tier: string
  per: Per
  /** where the provider hands them back when they paid, and when they did
   * not */
  done: string
  cancel: string
  /** the host's own name for what is bought, carried back on the checkout */
  reference: string
  /** carried on the checkout and the subscription it makes */
  tags: Tags
  /** the day time already given free runs through, which the subscription
   * starts with as a trial so its first charge falls after it */
  trial?: string | null
}

/** A subscription to a plan paid by invoice rather than at a checkout: the
 * provider sends `to` an invoice for each period, payable `due` days after
 * it is sent, by bank transfer or by a check the seller records as paid. */
export type Invoice = {
  payer: string
  tier: string
  per: Per
  /** where the invoices go, and the name they are made out to */
  to: { email: string; name: string }
  /** days from an invoice being sent to its falling due */
  due: number
  /** A durable request identity: the same key asked twice subscribes
   * once. */
  key: string
  /** carried on the subscription, as {@link Checkout.tags} */
  tags: Tags
  /** as {@link Checkout.trial}: the first invoice is sent when it ends */
  trial?: string | null
  addOn?: RecurringAddOn
}

export type RecurringAddOn = {
  key: string
  name: string
  cents: number
  start: string
  renewal: string
}

export type OneTimeInvoice = {
  payer: string
  key: string
  name: string
  cents: number
  due: number
  tags: Tags
}

/** A subscription as one call made it, and when the provider made it, which
 * orders it among the events about it that follow. */
export type Subscribed = { subscription: Subscription; at: string }

/** A hosted checkout for one thing paid for once, such as a block of
 * credit: its price whole, in the currency's smallest unit, tax included,
 * and what the buyer reads it as. Paid before anything is given for it. */
export type Once = {
  payer: string
  name: string
  cents: number
  currency: string
  done: string
  cancel: string
  /** the host's own name for what is bought, carried back on the checkout */
  reference: string
  /** carried on the checkout and every event about it */
  tags: Tags
}

/** A one-off checkout paid, as one verified event the provider posted says:
 * the checkout, which names the purchase however often it is told, whether
 * the money is there (a checkout can complete with its payment still on its
 * way, and a later event says it arrived), and what it carried. */
export type Bought = {
  about: 'purchase'
  at: string
  live: boolean
  checkout: string
  paid: boolean
  tags: Tags
  reference?: string
  payerName?: PayerName
}

/** The name and address a completed checkout reported for its payer. */
export type PayerName = { name: string; email?: string }

/** A subscription changed, as one verified event the provider posted says:
 * when and how it happened, what the object it is about carries, and the
 * subscription it is about. */
export type Changed = {
  about: 'subscription'
  /** when it happened */
  at: string
  /** whether it moved money, rather than happening in a sandbox */
  live: boolean
  /** what the object it is about was tagged with, its own or its
   * subscription's */
  tags: Tags
  /** the reference a checkout it is about carried */
  reference?: string
  /** where the payer said they are billed, from a checkout it is about that
   * asked: never the street or postal code, only the town, its state or
   * province, and the two-letter country */
  billed?: { city?: string; state?: string; country?: string }
  payerName?: PayerName
  /** the subscription it is about, read off it or asked for: undefined
   * where it is about none, null where the provider holds none by the name
   * it gives */
  subscription: () => Promise<Subscription | null | undefined>
}

/** What a provider sells a party: a payer minted once, a subscription to a
 * tier bought at its hosted checkout and managed at its hosted portal, and
 * the charges of one moved later. */
export type Plans = {
  /** whether it can be asked anything here: its credentials are set */
  on: () => boolean
  /** whether a tier is on sale here, paid for so often */
  offers: (tier: string, per: Per) => boolean
  /** where a subscription with this status stands */
  standing: (status: string) => Standing
  /** a new payer, its id */
  payer: (
    who: { email: string; name: string; tags: Tags; key?: string },
  ) => Promise<string>
  /** whom a payer is billed to; null where the provider holds none by that
   * id */
  billed: (payer: string) => Promise<{ email: string; name: string } | null>
  /** One payable checkout per payer and reference: reuse the same choice,
   * expire an earlier choice before opening another. */
  checkout: (asked: Checkout) => Promise<string>
  /** a subscription billed by invoice, made now: its first invoice is sent
   * within the hour, and it awaits that invoice's payment before it holds
   * its plan */
  invoice: (asked: Invoice) => Promise<Subscribed>
  /** Whether the provider is configured to set up support billing. */
  invoicingOn?: () => boolean
  /** Attach or revise a yearly item on an existing invoiced yearly plan. */
  addOn?: (subscription: string, item: RecurringAddOn) => Promise<string | null>
  /** Send a stand-alone invoice, once per payer and key. */
  invoiceOnce?: (asked: OneTimeInvoice) => Promise<string>
  /** The smallest standalone payment accepted in this currency. */
  minimum?: (currency: string) => number
  /** the address of a hosted checkout for something paid for once */
  once: (asked: Once) => Promise<string>
  /** A paid {@link once} checkout's payment refunded whole, for what was
   * bought and could not be given, or by the given number of cents. `key`
   * names the request: asked again, it refunds nothing twice. */
  refunded: (
    asked: { key: string; checkout: string; tags: Tags; cents?: number },
  ) => Promise<Refunded>
  /** the address of the hosted portal where a payer manages what it pays,
   * handing them back to `back` */
  portal: (payer: string, back: string) => Promise<string>
  /** a subscription, or null where the provider holds none by that id */
  subscription: (id: string) => Promise<Subscription | null>
  /** Every subscription this payer currently holds. */
  subscriptions: (payer: string) => Promise<Subscription[]>
  /** when a subscription next charges; null where nothing says */
  charges: (id: string) => Promise<string | null>
  /** a subscription's next charge moved to `until`, prorating nothing,
   * unless it falls then or later: asked again, it moves nothing twice */
  postpone: (id: string, until: string) => Promise<void>
}

/** A seller's account as its provider reads it: its id, whether it may take
 * payments now, and whether its owner finished the provider's form, which
 * alone does not make it ready.
 *
 * The house is a seller that sells on the host's own account rather than one
 * of its own: the host is the merchant, the provider's fees are the host's,
 * and no fee is taken, since the host would pay it to itself. Its account is
 * '' wherever {@link Shops} names one, and every event about its sales names
 * none ({@link Shopped}). */
export type Seller = {
  account: string
  ready: boolean
  submitted: boolean
  house?: boolean
}

/** One line of a sale: what the buyer reads it as, its price in the
 * currency's smallest unit, and how many. */
export type Line = { name: string; cents: number; qty: number }

/** The delivery address verified when a physical service was quoted. */
export type Shipping = {
  name: string
  phone?: string
  address: {
    line1: string
    line2?: string
    city: string
    state?: string
    postal_code: string
    country: string
  }
}

/** An immutable seller quote. All amounts are in the currency's smallest unit;
 * subtotal covers the complete quantity, and total includes shipping and tax. */
export type Quote = {
  id: string
  buyer: string
  source: string
  seller: string
  document: string
  revision: string
  specification: string
  name: string
  quantity: number
  currency: string
  destination: Shipping
  shipping: { id: string; name: string; cents: number }
  subtotal: number
  tax: number
  total: number
  expires: string
}

/** A hosted checkout on a seller's account: paid once, or, where it says
 * how often, a subscription that charges its lines again each period until
 * it is cancelled. */
export type Sale = {
  /** A durable request identity: retries address the same checkout. */
  key?: string
  /** A fixed physical quote; the provider does not offer address edits. */
  destination?: Shipping
  shipping?: { name: string; cents: number }
  expires?: string
  lines: Line[]
  currency: string
  /** how often every line is charged again; none for a sale paid once */
  per?: Per
  /** the host's share of each payment, in basis points (250 is 2.5%), which
   * the provider takes for it, rounded down; none when 0 */
  bps: number
  /** the buyer's address to start the page with, if one is known */
  email?: string
  /** Offer cards and card wallets in the sale currency. */
  cardOnly?: boolean
  /** the seller's name, which the buyer's card statement reads after the
   * host's on a sale on the host's own account; a seller's own account
   * already names them there */
  descriptor?: string
  /** where the provider hands the buyer back when they paid, and when they
   * did not: addresses the host checked as `URL` writes them, so a
   * placeholder the provider fills in on the way back arrives
   * percent-encoded, and the provider writes it back as it reads it */
  done: string
  cancel: string
  /** carried on the checkout and the payment it makes, so every event about
   * either says whose sale it is, each no longer than {@link Shops.tag} */
  tags: Tags
}

/** A completed checkout, as its provider reads it. */
export type Paid = {
  currency?: string
  /** whether the money is there: a checkout can complete with its payment
   * still processing */
  paid: boolean
  /** the provider's own word for where the payment stands, for a sentence */
  status: string
  /** the checkout's id, and the payment it made, which every later word
   * about the sale names: '' for a subscription's, whose payments are its
   * own */
  checkout: string
  payment: string
  /** the subscription it started, where it sold one ({@link Term}) */
  subscription?: string
  /** what was paid, in the currency's smallest unit */
  total: number
  /** the address the buyer gave, else the one the checkout started with */
  email: string
  /** the name the buyer gave, where the checkout asked for one */
  name?: string
  /** Time and mode of the provider event that confirmed a gift. */
  gift?: { at: string; live: boolean }
  /** what the checkout carried ({@link Sale.tags}) */
  tags: Tags
}

/** A merchant's durable refund request. The key survives retries, including
 * a response lost after the provider accepted the refund. */
export type Refund = {
  key: string
  payment: string
  amount: number
  fee?: boolean
  tags: Tags
}

/** What the provider says about one refund, including asynchronous changes. */
export type Refunded = {
  id: string
  payment: string
  amount: number
  status: 'pending' | 'succeeded' | 'failed' | 'canceled'
  tags: Tags
}

/** A payment read from a charge or dispute event. Refund amounts are cumulative
 * provider facts; older events may not carry them. */
export type Payment = {
  id: string
  tags: Tags
  total?: number
  refunded?: number
  fee?: string
}

/** Where an order's payment moved: `refunded` in whole or `partially_refunded`
 * in part, `disputed` by the buyer, then `lost` to them or `restored` to the
 * seller. */
export type Settled =
  | 'refunded'
  | 'partially_refunded'
  | 'disputed'
  | 'lost'
  | 'restored'

/** A subscription a buyer took out at a seller's checkout, as the term it
 * is paid for. Whether it is paid for now is `until` against the clock, so
 * nothing about it is a status to keep. */
export type Term = {
  id: string
  /** when what was paid for runs out: the period's end while it renews or
   * its charge is being retried, the start of the period it failed to pay
   * once it lapsed, when it stopped once it ended, and null where nothing was
   * ever paid */
  until: string | null
  /** set only when it will not renew: when it stops, or stopped */
  ending: string | null
  /** what the checkout that started it carried ({@link Sale.tags}) */
  tags: Tags
}

/** One period of a subscription on a seller's account, paid: the invoice,
 * the subscription and the payer it billed, what was paid in the currency's
 * smallest unit, when, the address and name it was billed to, and the tags
 * the checkout that started the subscription carried ({@link Sale.tags}). */
export type Billed = {
  id: string
  subscription: string
  payer: string
  total: number
  at: string
  email: string
  name?: string
  live?: boolean
  tags: Tags
}

/** One verified event a seller's account posted, read, with the account it
 * happened on ('' where it names none, as an event about a house sale on the
 * host's own account does, whose tags say whose sale it was): the seller's account changed, or it
 * revoked the host's permission to act on it, or a checkout completed, or a
 * payment moved, or a subscription's term moved (it renewed, was cancelled or
 * lapsed), or something the host has no word for. */
export type Shopped =
  & { account: string }
  & (
    | { about: 'seller'; seller: Seller }
    | { about: 'revoked' }
    | { about: 'sale'; sale: Paid }
    | { about: 'refund'; refund: Refunded }
    | {
      about: 'payment'
      to: Settled
      /** the payment it moved and what it carried, read on asking; null
       * where the event names none */
      payment: () => Promise<Payment | null>
    }
    | {
      about: 'term'
      /** the subscription as it stands now, read on asking, so events
       * delivered out of order still leave the latest word; null where the
       * event names none, or the provider holds none by that name */
      term: () => Promise<Term | null>
      /** the period's invoice, where the event is one paid */
      invoice?: Billed
    }
    | { about: 'other' }
  )

/** What a provider charges a seller, as its published pricing says, for
 * the pages that tell a seller what selling costs before they start. */
export type Costs = {
  /** a payment by a card from the seller's own country: a rate in basis
   * points of the payment, plus a fixed amount in cents */
  card: { bps: number; cents: number }
  /** Additional estimated billing costs for recurring payments. */
  recurring?: number
  /** what a card from another country adds to the rate, in basis points */
  abroad: number
  /** the fee for a payment a buyer disputes with their bank, in cents,
   * returned when the seller wins */
  dispute: number
  /** whether the processing fee comes back when a payment is refunded */
  refunded: boolean
  /** days from a sale to its payout, and from a new account's first sale
   * to its first payout */
  payout: { days: number; first: number }
  /** the country those numbers are for, and where the provider publishes
   * them for every other */
  country: string
  pricing: string
}

/** What a provider keeps of a card payment of `cents`: its rate, rounded to
 * the nearest cent, plus its fixed amount, never more than the payment.
 *
 * ```ts
 * import { charged } from '@yaks/host/payments'
 * import { equal } from '@yaks/testing'
 * let card = { bps: 290, cents: 30 }
 * equal(charged(card, 2000), 88)
 * equal(charged(card, 1999), 88)
 * equal(charged(card, 10), 10)
 * ```
 */
export let charged = (
  card: Costs['card'],
  cents: number,
): number => Math.min(cents, Math.round(cents * card.bps / 10_000) + card.cents)

/** What a payer adds to `cents` so that what the provider keeps of the whole
 * ({@link charged}) leaves the seller `cents`: the least that does.
 *
 * ```ts
 * import { charged, covering } from '@yaks/host/payments'
 * import { equal } from '@yaks/testing'
 * let card = { bps: 290, cents: 30 }
 * equal(covering(card, 10000), 330)
 * equal(10330 - charged(card, 10330) >= 10000, true)
 * equal(10329 - charged(card, 10329) < 10000, true)
 * equal(covering(card, 2500), 106)
 * ```
 */
export let covering = (card: Costs['card'], cents: number): number => {
  let whole = Math.ceil((cents + card.cents) / (1 - card.bps / 10_000)) - 1
  while (whole - charged(card, whole) < cents) whole++
  while (whole > cents && whole - 1 - charged(card, whole - 1) >= cents) whole--
  return whole - cents
}

/** What a provider lends a party selling on an account of its own: the
 * account opened once and finished through the provider's onboarding, or one
 * the seller already had and connected at the provider's own page, and
 * hosted checkouts on it, paid once or by subscription, which the host takes
 * a fee from. An account named '' is the host's own, the house's
 * ({@link Seller}): its checkouts take no fee and are paid once. */
export type Shops = {
  /** whether it can be asked anything here: its credentials are set */
  on: () => boolean
  /** what selling through it costs a seller */
  costs: Costs
  /** the least one payment may be in a currency, in its smallest unit */
  minimum: (currency: string) => number
  /** Which mode this connection can charge in. */
  mode: () => 'test' | 'live' | undefined
  /** the most characters one tag's value carries ({@link Sale.tags}): a
   * longer one the provider refuses or cuts short */
  tag: number
  /** a new account for a seller, started with their address if one is known
   * and carrying `tags` */
  open: (who: { email?: string; tags: Tags }) => Promise<Seller>
  /** the address of the provider's onboarding for an account, handing them
   * back to `back` when they finish or the address goes stale: the provider's
   * own page for an account the seller brought, which only they may change */
  onboarding: (account: string, back: string) => Promise<string>
  /** the address of the provider's page where a seller connects an account
   * they already have, handing them back to `back` with `state` and a code
   * {@link authorized} reads; null where the provider cannot connect one
   * here */
  authorize: (state: string, back: string) => string | null
  /** the account a seller connected at {@link authorize}, from the code they
   * were handed back with, which is good once */
  authorized: (code: string) => Promise<Seller>
  /** the address of a hosted checkout on a seller's account */
  checkout: (account: string, sale: Sale) => Promise<string>
  /** a checkout on a seller's account as it stands, read back by its id,
   * completed or not; null where the provider holds none by that id */
  paid: (account: string, checkout: string) => Promise<Paid | null>
  /** a subscription on a seller's account as it stands; null where the
   * provider holds none by that id */
  term: (account: string, subscription: string) => Promise<Term | null>
  /** a subscription on a seller's account set to stop when the period paid
   * for ends, and as it then stands: asked again, it changes nothing */
  cancel: (account: string, subscription: string) => Promise<Term>
  /** Refund on the merchant's account, returning the application fee in
   * proportion. An identical key and request must never refund twice. */
  refund: (account: string, request: Refund) => Promise<Refunded>
  /** the address of the provider's hosted portal on a seller's account,
   * where its payer manages and cancels what it pays, handing them back to
   * `back` */
  portal: (
    account: string,
    payer: string,
    subscription: string,
    back: string,
  ) => Promise<string>
  /** Reconcile a dashboard refund's cumulative application-fee reversal. */
  refundFee: (fee: string, refunded: number, total: number) => Promise<void>
}

/** One verified event the provider posted, read into the host's words: a
 * subscription changed, a one-off checkout was paid, or something happened
 * on a seller's account. */
export type Heard = Changed | Bought | Shopped

/** What a door said of one request posted to it: the event it heard, or why
 * it refused it, `ours` where the refusal can mean the host's own secret is
 * wrong, which is worth reporting. */
export type Said = { heard: Heard } | { refused: string; ours: boolean }

/** A webhook door: one request the provider posted, verified and read.
 * Undefined where it holds no secret to verify with, so it hears nothing. */
export type Door = (request: Request) => Promise<Said | undefined>

/** A payment provider as it is lent. */
export type Payments = {
  /** its name, as people read it: the account they open, the page they pay
   * on */
  name: string
  plans: Plans
  shops: Shops
  /** its webhook doors by name, which a host serves at `/<via>/<name>`, `via`
   * the name it is lent under, so the provider is told one address per door
   * and every door's events reach the host read */
  doors: Record<string, Door>
}
