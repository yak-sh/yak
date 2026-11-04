// Text messages from a space's operator: the number a person gave and the
// words they agreed to, on the person in the directory (@yaks/phone). Sending
// is a channel of its own; this keeps the consent it must read first.
import type { Bundle } from '@yaks/graph'
import { consentEid, mobile } from '@yaks/phone'
import { refuse } from './tool.ts'

/** The consent box's words, kept with each person who agreed to them. */
export let CONSENT =
  'I agree to receive app notifications by text from yaks.app about my site: when the operator finishes a change, needs an answer from me, or my site needs attention. About 1-10 msgs/month. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Terms: https://yaks.app/terms Privacy: https://yaks.app/privacy'

/** The number a person is texted at, and the words and moment they agreed. */
export type Texting = { number: string; consent: string; at: string }

/**
 * The directory rows that agree to texts at `number`: the person's
 * `phone{number}` and their `sms_consent`. An empty number stops texts and
 * keeps the number.
 *
 * ```ts
 * import { equal, throws } from '@yaks/testing'
 * import { texts } from './operator-texts.ts'
 * let [phone] = texts('ana', '(269) 555-0142', true, '2026-11-04T00:00:00Z')
 * equal(phone, { entity: { eid: 'ana' }, phone: { number: '+12695550142' } })
 * throws(() => texts('ana', '555-0142', true))
 * throws(() => texts('ana', '269-555-0142', false))
 * ```
 */
export let texts = (
  person: string,
  number: string,
  agreed: boolean,
  at = new Date().toISOString(),
): Bundle[] => {
  let entity = { eid: consentEid(person) }
  if (!number.trim()) return [{ entity, sms_consent: null }]
  let e164 = mobile(number)
  if (!e164) {
    throw refuse(
      'arguments',
      'Enter a US mobile number with its area code, like 269-555-0142.',
    )
  }
  if (!agreed) {
    throw refuse(
      'arguments',
      'Tick the box to agree to texts, or leave the number empty.',
    )
  }
  return [
    { entity: { eid: person }, phone: { number: e164 } },
    { entity, sms_consent: { person, consent: CONSENT, at } },
  ]
}

// TODO(T-136921): a space's operator store kept the opt-in as
// `sms_consent{person, number, consent, at}` until the number moved onto the
// person. The Operator page hands those rows to the directory as it opens;
// this and the operator store's old declaration go once no store holds one.
/** A row the operator store kept, as the directory keeps it. */
export let handed = (
  kept: { person: string; number: string; consent: string; at: string },
): Bundle[] => [
  { entity: { eid: kept.person }, phone: { number: kept.number } },
  {
    entity: { eid: consentEid(kept.person) },
    sms_consent: { person: kept.person, consent: kept.consent, at: kept.at },
  },
]
