// A typed number in the form `phone{number}` keeps, checked against
// libphonenumber's mobile metadata: a module of its own, so what imports the
// rest of @yaks/phone (a sender's statuses, a received text) never loads it.

import { parsePhoneNumberFromString } from 'libphonenumber-js/mobile'

/**
 * A US mobile number in E.164 form, or null when `typed` is not one.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { mobile } from '@yaks/phone/mobile'
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
