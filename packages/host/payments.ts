/** What a payment provider lends a host that takes money through it (the
 * lending kind `payments`, ./lending.ts): its name, for the sentences people
 * read, the plans it sells a party, the shops a party sells through on an
 * account of its own, and the webhook doors it hears both at. Each is
 * functions over the provider's own wire, answering in words that name no
 * provider, so a host's billing keeps its rules and refusals and a second
 * provider has one contract to meet. */

/** A party's details and tags as a payer is minted with them, and what every
 * object the provider makes for that party carries back: the host's own
 * words, such as whose it is and where it was bought. */
export type Tags = Record<string, string>

/** How often a plan is paid for. */
export type Per = 'month' | 'year'

/** Where a subscription stands, as its provider reads its status: `paying`
 * and billed as it should be, `owing` still held while a failed charge is
 * retried, `lapsed` no longer paid for though it may be again, `ended` over
 * for good, which no later word of the provider undoes. */
export type Standing = 'paying' | 'owing' | 'lapsed' | 'ended'

/** A subscription as its provider reads it. */
export type Subscription = {
  id: string
  /** the payer it bills */
  payer: string
  /** the tier its price buys, one of those the provider was configured to
   * sell, whatever it stands at */
  tier: string
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
}

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
  payer: (who: { email: string; name: string; tags: Tags }) => Promise<string>
  /** whom a payer is billed to; null where the provider holds none by that
   * id */
  billed: (payer: string) => Promise<{ email: string; name: string } | null>
  /** the address of a hosted checkout */
  checkout: (asked: Checkout) => Promise<string>
  /** the address of a hosted checkout for something paid for once */
  once: (asked: Once) => Promise<string>
  /** the address of the hosted portal where a payer manages what it pays,
   * handing them back to `back` */
  portal: (payer: string, back: string) => Promise<string>
  /** a subscription, or null where the provider holds none by that id */
  subscription: (id: string) => Promise<Subscription | null>
  /** when a subscription next charges; null where nothing says */
  charges: (id: string) => Promise<string | null>
  /** a subscription's next charge moved to `until`, prorating nothing,
   * unless it falls then or later: asked again, it moves nothing twice */
  postpone: (id: string, until: string) => Promise<void>
}

/** A seller's account as its provider reads it: its id, whether it may take
 * payments now, and whether its owner finished the provider's form, which
 * alone does not make it ready. */
export type Seller = { account: string; ready: boolean; submitted: boolean }

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

/** A hosted checkout on a seller's account. */
export type Sale = {
  /** A durable request identity: retries address the same checkout. */
  key?: string
  /** A fixed physical quote; the provider does not offer address edits. */
  destination?: Shipping
  shipping?: { name: string; cents: number }
  expires?: string
  lines: Line[]
  currency: string
  /** what the host takes of it, in the same unit; none when 0 */
  fee: number
  /** the buyer's address to start the page with, if one is known */
  email?: string
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
   * about the sale names */
  checkout: string
  payment: string
  /** what was paid, in the currency's smallest unit */
  total: number
  /** the address the buyer gave, else the one the checkout started with */
  email: string
  /** what the checkout carried ({@link Sale.tags}) */
  tags: Tags
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

/** One verified event a seller's account posted, read, with the account it
 * happened on ('' where it names none): the seller's account changed, or it
 * revoked the host's permission to act on it, or a checkout completed, or a
 * payment moved, or something the host has no word for. */
export type Shopped =
  & { account: string }
  & (
    | { about: 'seller'; seller: Seller }
    | { about: 'revoked' }
    | { about: 'sale'; sale: Paid }
    | {
      about: 'payment'
      to: Settled
      /** the payment it moved and what it carried, read on asking; null
       * where the event names none */
      payment: () => Promise<{ id: string; tags: Tags } | null>
    }
    | { about: 'other' }
  )

/** What a provider lends a party selling on an account of its own: the
 * account opened once and finished through the provider's onboarding, and
 * hosted checkouts on it, which the host takes a fee from. */
export type Shops = {
  /** whether it can be asked anything here: its credentials are set */
  on: () => boolean
  /** the most characters one tag's value carries ({@link Sale.tags}): a
   * longer one the provider refuses or cuts short */
  tag: number
  /** a new account for a seller, started with their address if one is known
   * and carrying `tags` */
  open: (who: { email?: string; tags: Tags }) => Promise<Seller>
  /** the address of the provider's onboarding for an account, handing them
   * back to `back` when they finish or the address goes stale */
  onboarding: (account: string, back: string) => Promise<string>
  /** the address of a hosted checkout on a seller's account */
  checkout: (account: string, sale: Sale) => Promise<string>
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
