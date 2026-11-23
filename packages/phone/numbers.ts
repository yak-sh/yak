// A provider's numbers: what it has on offer and at what price, buying one
// onto the account a phone texts through, giving one back, and the
// toll-free verification carriers ask of a number before it texts. A
// provider gives its `Numbers` as data (./provider.ts `numbers`); nothing
// here names one.

/** What to look for. */
export type Search = {
  /** ISO country code (default US) */
  country?: string
  /** toll-free numbers only */
  tollFree?: boolean
  /** a three-digit area code */
  area?: string
  /** digits the number contains */
  contains?: string
  /** exactly this number, in E.164 form, to quote it before buying */
  number?: string
  /** at most this many (default 5) */
  limit?: number
}

/** A number on offer, at its price in `currency`. */
export type Offer = {
  number: string
  /** what buying it costs once */
  upfront: number
  /** what holding it costs each month */
  monthly: number
  currency: string
  sms: boolean
  voice: boolean
}

/** A number bought: the provider's order for it, and whether it is held yet. */
export type Bought = {
  number: string
  order: string
  /** `pending` until the provider has it on the account */
  status: 'held' | 'pending'
}

/** Where an organization is. */
export type Address = {
  street: string
  street2?: string
  city: string
  /** a two-letter state or province */
  state: string
  zip: string
}

/** The kinds of organization carriers verify. */
export type Entity =
  | 'sole_proprietor'
  | 'private_profit'
  | 'public_profit'
  | 'non_profit'
  | 'government'

/**
 * What a toll-free verification asks: who sends, who answers for it, and the
 * texts it sends and how people asked for them. The fields are the carriers'
 * own, whichever provider files them.
 */
export type TollFree = {
  /** the toll-free number it verifies, in E.164 form */
  number: string
  business: {
    /** the legal name */
    name: string
    /** the name people know it by, where it differs */
    dba?: string
    website: string
    address: Address
    entity: Entity
    /** its tax or registration number: an EIN in the US */
    registration?: { number: string; type: string; country: string }
  }
  contact: { first: string; last: string; email: string; phone: string }
  /** the provider's name for what the texts are for, such as "Religious
   * Services" */
  useCase: string
  /** what the texts are, in a sentence or two */
  summary: string
  /** a text as it will be sent */
  sample: string
  /** how many a month, in the provider's bands, such as "1,000" */
  volume: string
  /** how people ask to be texted, in words */
  optIn: string
  /** pictures of where they ask */
  optInImages: string[]
  /** the text sent when someone opts in, and the answer to HELP */
  confirmation?: string
  help?: string
  /** the words that opt someone in, such as "START, YES" */
  keywords?: string
  privacy?: string
  terms?: string
  /** anything else the reviewer should know */
  more?: string
  /** the platform filing for its customer, where one does */
  reseller?: string
}

/** Where a toll-free verification stands: `pending` while carriers review
 * it, `needed` while they wait on an answer from the sender, `verified`, or
 * `rejected` with why. `said` is the provider's own word for it. */
export type Verification = {
  id: string
  number: string
  status: 'pending' | 'needed' | 'verified' | 'rejected'
  said: string
  reason?: string
}

/** A provider's numbers, on the account its phone texts through. */
export type Numbers = {
  find: (search: Search) => Promise<Offer[]>
  /** buys a number on offer and puts its texts on the phone's profile */
  buy: (number: string) => Promise<Bought>
  /** gives a held number back; it costs nothing from then on */
  release: (number: string) => Promise<void>
  /** files a toll-free verification */
  verify: (form: TollFree) => Promise<Verification>
  /** where a filed verification stands now */
  verification: (id: string) => Promise<Verification>
}

/** A provider's {@link Numbers} kept in memory. */
export type Shelf = Numbers & {
  /** the numbers held, by number */
  held: Set<string>
  /** every verification filed, by id */
  filed: Map<string, TollFree & { status: Verification['status'] }>
}

/**
 * Numbers in memory, for tests and a box with no provider: `offers` are on
 * offer until bought, a bought number is held, and a verification is pending
 * until a test sets its status in `filed`.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { shelf } from '@yaks/phone'
 * let numbers = shelf([{ number: '+18885550100', upfront: 1, monthly: 1,
 *   currency: 'USD', sms: true, voice: true }])
 * equal((await numbers.find({ tollFree: true })).length, 1)
 * equal((await numbers.buy('+18885550100')).status, 'held')
 * equal(await numbers.find({ tollFree: true }), [])
 * ```
 */
export let shelf = (offers: Offer[] = []): Shelf => {
  let held = new Set<string>()
  let filed: Shelf['filed'] = new Map()
  let free = (n: string) => /^\+18(00|33|44|55|66|77|88)/.test(n)
  let state = (id: string): Verification => {
    let form = filed.get(id)
    if (!form) throw new Error(`No verification ${id}`)
    return { id, number: form.number, status: form.status, said: form.status }
  }
  return {
    held,
    filed,
    find: (s) =>
      Promise.resolve(
        offers.filter((o) =>
          !held.has(o.number) && (!s.tollFree || free(o.number)) &&
          (!s.number || o.number == s.number) &&
          (!s.area || o.number.startsWith(`+1${s.area}`)) &&
          (!s.contains || o.number.includes(s.contains))
        ).slice(0, s.limit ?? 5),
      ),
    buy: (number) => {
      if (held.has(number) || !offers.some((o) => o.number == number)) {
        return Promise.reject(new Error(`${number} is not on offer`))
      }
      held.add(number)
      return Promise.resolve({
        number,
        order: `order-${held.size}`,
        status: 'held',
      })
    },
    release: (number) => {
      if (!held.delete(number)) {
        return Promise.reject(new Error(`${number} is not held`))
      }
      return Promise.resolve()
    },
    verify: (form) => {
      let id = `verification-${filed.size + 1}`
      filed.set(id, { ...form, status: 'pending' })
      return Promise.resolve(state(id))
    },
    verification: (id) => Promise.resolve().then(() => state(id)),
  }
}
