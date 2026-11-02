// Text messages from a space's operator: the number a person gave and the
// words they agreed to. Sending is a channel of its own; this keeps the
// consent it must read first.
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { refuse } from './tool.ts'

/** The consent box's words, kept with each number that agreed to them. */
export let CONSENT =
  'I agree to receive text messages from yaks.app about my site, about 1-10 a month. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Terms: https://yaks.app/terms Privacy: https://yaks.app/privacy'

export let textsEid = (person: string) => derivedEid('operator-texts|' + person)

/**
 * A US mobile number in E.164 form, or a refusal.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { mobile } from './operator-texts.ts'
 * assertEquals(mobile('(269) 555-0142'), '+12695550142')
 * assertEquals(mobile('+1 269 555 0142'), '+12695550142')
 * ```
 */
export let mobile = (number: string) => {
  let digits = number.replace(/\D/g, '')
  if (digits.length == 10) digits = '1' + digits
  if (!/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
    throw refuse(
      'arguments',
      'Enter a US mobile number with its area code, like 269-555-0142.',
    )
  }
  return '+' + digits
}

/** The row that agrees to texts at `number`, or stops them when it is empty. */
export let texts = (
  person: string,
  number: string,
  agreed: boolean,
): Bundle => {
  let entity = { eid: textsEid(person) }
  if (!number.trim()) return { entity, sms_consent: null }
  if (!agreed) {
    throw refuse(
      'arguments',
      'Tick the box to agree to texts, or leave the number empty.',
    )
  }
  return {
    entity,
    sms_consent: {
      person,
      number: mobile(number),
      consent: CONSENT,
      at: new Date().toISOString(),
    },
  }
}
