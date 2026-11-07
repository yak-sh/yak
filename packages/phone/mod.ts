/**
 * Phone numbers and texts: a person's number as `phone{number}`, the consent they gave
 * to be texted as `sms_consent{person, consent, at}`, and `mobile` to put a
 * typed number in the form both are kept in.
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js/mobile'

export { phoneDoc } from './vocab.ts'

/**
 * A US mobile number in E.164 form, or null when `typed` is not one.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { mobile } from '@yaks/phone'
 * equal(mobile('(269) 555-0142'), '+12695550142')
 * equal(mobile('+1 269 555 0142'), '+12695550142')
 * equal(mobile('555-0142'), null)
 * equal(mobile('(069) 555-0142'), null)
 * equal(mobile('(876) 555-0142'), null)
 * equal(mobile('(900) 555-0142'), null)
 * equal(mobile('(530) 555-0142'), '+15305550142')
 * equal(mobile('(851) 555-0142'), null)
 * equal(mobile('(299) 555-0142'), null)
 * equal(mobile('(800) 555-0142'), null)
 * equal(mobile('(416) 555-0142'), null)
 * equal(mobile('(787) 555-0142'), '+17875550142')
 * equal(mobile('+44 7700 900123'), null)
 * ```
 */
export let mobile = (typed: string): string | null => {
  let number = parsePhoneNumberFromString(typed, 'US')
  return number?.isValid() && US.has(number.country) ? number.number : null
}

// The regions that are a place in the US: the states and the territories.
// Everything else sharing +1 is refused: Canada, the Caribbean and Atlantic
// countries, and through libphonenumber's mobile metadata toll-free,
// premium-rate 900, the other non-geographic codes, N11 and codes not yet
// assigned. A text to the Caribbean or to 900 costs many times a US text and
// is what SMS pumping walks.
let US = new Set<string | undefined>(['US', 'PR', 'VI', 'GU', 'AS', 'MP'])

/**
 * A number in `mobile`'s form as a person in the US writes it; anything else
 * as it came.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { shown } from '@yaks/phone'
 * equal(shown('+12695550142'), '(269) 555-0142')
 * equal(shown('+447700900123'), '+447700900123')
 * ```
 */
export let shown = (number: string): string => {
  let d = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number)
  return d ? `(${d[1]}) ${d[2]}-${d[3]}` : number
}

export {
  type Arrival,
  Blocked,
  consentEid,
  Denied,
  type Keyword,
  keyword,
  type Outcome,
  type Receipt,
  type Sender,
  type Text,
} from './text.ts'
export { type Stash, stash } from './stash.ts'
export { arrivalEid, kept, settled } from './received.ts'
export { owed, sending, type Texting } from './send.ts'
export type { Options, Transport } from './options.ts'

export {
  type Account,
  type Heard,
  type Held,
  listens,
  type Own,
  type Provider,
  sender,
  verified,
} from './provider.ts'
export type { Caller, Frame, Line, Ring } from './call.ts'
export {
  type Address,
  type Bought,
  type Entity,
  type Numbers,
  type Offer,
  type Search,
  type Shelf,
  shelf,
  type TollFree,
  type Verification,
} from './numbers.ts'
