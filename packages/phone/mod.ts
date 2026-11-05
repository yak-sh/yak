/**
 * Phone numbers and texts: a person's number as `phone{number}`, the consent they gave
 * to be texted as `sms_consent{person, consent, at}`, and `mobile` to put a
 * typed number in the form both are kept in.
 */

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
 * ```
 */
export let mobile = (typed: string): string | null => {
  let digits = typed.replace(/\D/g, '')
  if (digits.length == 10) digits = '1' + digits
  return /^1[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? '+' + digits : null
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
export type { Door, Options, Transport } from './options.ts'

export { type Load, type Provider, provider, sender } from './provider.ts'
