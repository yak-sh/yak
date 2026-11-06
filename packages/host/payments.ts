/** What a payment provider lends a host that takes money through it (the
 * lending kind `payments`, ./lending.ts): its name, for the sentences people
 * read, and the plans it sells a party. Each is functions over the provider's
 * own wire, answering in words that name no provider, so a host's billing
 * keeps its rules and refusals and a second provider has one contract to
 * meet. */

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

/** One verified event the provider posted, read: when and how it happened,
 * what the object it is about carries, and the subscription it is about. */
export type Heard = {
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
  /** one event the provider posted, already verified, read */
  heard: (event: unknown) => Heard
}

/** A payment provider as it is lent. */
export type Payments = {
  /** its name, as people read it: the account they open, the page they pay
   * on */
  name: string
  plans: Plans
}
