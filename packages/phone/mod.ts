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
 * equal(mobile('(876) 555-0142'), null)
 * equal(mobile('(900) 555-0142'), null)
 * ```
 */
export let mobile = (typed: string): string | null => {
  let digits = typed.replace(/\D/g, '')
  if (digits.length == 10) digits = '1' + digits
  return /^1[2-9]\d{2}[2-9]\d{6}$/.test(digits) &&
      !ABROAD.has(digits.slice(1, 4)) &&
      !/^(8(\d)\2|[2-9]11)$/.test(digits.slice(1, 4))
    ? '+' + digits
    : null
}

// Area codes that share +1 but are not a person's number in the US: Canada,
// the Caribbean and Atlantic countries, and the non-geographic codes (personal,
// government, premium-rate). A text to the Caribbean ones and to 900 costs many
// times a US text and is what SMS pumping walks; toll-free (8NN) and N11 are
// matched by shape beside them. US territories (340, 670, 671, 684, 787, 939)
// are the US.
let ABROAD = new Set(
  (
    // Canada
    '204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 387 403 ' +
    '416 418 428 431 437 438 450 460 468 474 506 514 519 548 579 581 584 ' +
    '587 600 604 613 622 639 647 672 683 705 709 742 753 778 780 782 807 ' +
    '819 825 867 873 879 902 905 942 ' +
    // the Caribbean and the Atlantic
    '242 246 264 268 284 345 441 473 649 658 664 721 758 767 784 809 829 ' +
    '849 868 869 876 ' +
    // non-geographic
    '500 521 522 523 524 525 526 527 528 529 530 531 532 533 544 566 577 ' +
    '588 700 710 900'
  ).split(' '),
)

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
export type { Door, Options, Transport } from './options.ts'

export { type Load, type Provider, provider, sender } from './provider.ts'
