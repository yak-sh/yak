/**
 * Phone numbers and texts: a person's number as `phone{number}` and the
 * consent they gave to be texted as `sms_consent{person, consent, at}`.
 * `mobile` (@yaks/phone/mobile) puts a typed number in the form both are kept
 * in.
 */

export { phoneDoc } from './vocab.ts'

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
  echo,
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
