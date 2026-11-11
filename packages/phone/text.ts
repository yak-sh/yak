// Texting's shapes: a text on its way out, one that arrived, what became of
// one that left, and the keywords a person texts to stop or ask for help.
// Providers translate their wire formats at the boundary.

import type { Texter } from '@yaks/host/senders'
import { identityEid } from '@yaks/graph/identity'

/** The eid of a person's `sms_consent`, derived from them. */
export let consentEid = (person: string): string =>
  identityEid('sms_consent', [person])

// A text and its receipt are the host's portable texter capability, so a
// host can lend one (`texters`) without knowing this package.
export type { Text, TextReceipt as Receipt } from '@yaks/host/senders'

/** A sender resolves when the text is accepted and rejects when it is not:
 * {@link Blocked} when the carrier will not carry it, through nobody's fault
 * here; {@link Denied} when the provider refused the credentials; any other
 * rejection is a failure. `from`, where the provider can say it, answers the
 * number its texts go from when a text names none: the number people text to
 * reach whoever sends through it. */
export type Sender = Texter & { from?: () => Promise<string> }

/** A text that arrived. */
export type Arrival = {
  /** The transport it arrived on, when the host names one. */
  via?: string
  /** the provider's id for the message */
  id: string
  /** the number it came from */
  from: string
  /** the number it was sent to, or the RCS agent's id when `rcs` */
  to: string
  /** the words; for a tapped suggestion, its label */
  text: string
  /** when it arrived */
  at: string
  /** whether it came as RCS, so an answer goes back the same way */
  rcs: boolean
  /** pictures and files sent with it (MMS), each at a provider URL */
  media: { url: string; type: string }[]
}

/** What became of a text that left, as the provider reports it later. */
export type Outcome = {
  /** the id the receipt gave */
  id: string
  /** why it did not arrive; absent when it did */
  failed?: { code: string; reason: string; blocked: boolean }
}

/** The carrier will not carry this text, and that is expected: a number not
 * yet registered for business texting, or a person who replied STOP. The
 * message is a sentence a person can read. */
export class Blocked extends Error {
  code: string
  constructor(message: string, code = '') {
    super(message)
    this.name = 'Blocked'
    this.code = code
  }
}

/** The provider refused the credentials it was given: the key is wrong, or
 * the account does not let this address call. Nothing about the text is
 * wrong; whoever holds the account mends it, and the message says how. */
export class Denied extends Error {
  code: string
  constructor(message: string, code = '') {
    super(message)
    this.name = 'Denied'
    this.code = code
  }
}

/** The keywords carriers require every business number to answer. */
export type Keyword = 'stop' | 'help' | 'start'

let WORDS: Record<string, Keyword> = {
  STOP: 'stop',
  STOPALL: 'stop',
  UNSUBSCRIBE: 'stop',
  CANCEL: 'stop',
  END: 'stop',
  QUIT: 'stop',
  HELP: 'help',
  INFO: 'help',
  START: 'start',
  YES: 'start',
  UNSTOP: 'start',
}

/**
 * The keyword a text is, or null when it says something else. A keyword is
 * the whole text, in any case, with any punctuation around it. YES opts in
 * only someone who is `stopped`; from anyone else it answers a question and
 * is no keyword.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { keyword } from '@yaks/phone'
 * equal(keyword(' Stop.'), 'stop')
 * equal(keyword('help'), 'help')
 * equal(keyword('YES'), 'start')
 * equal(keyword('YES', false), null)
 * equal(keyword('start', false), 'start')
 * equal(keyword('stop the meeting notice'), null)
 * ```
 */
export let keyword = (text: string, stopped = true): Keyword | null => {
  let word = text.trim().replace(/^\W+|\W+$/g, '').toUpperCase()
  return word == 'YES' && !stopped ? null : WORDS[word] ?? null
}

/** Whether the person whose texts are `said`, oldest first, last said STOP. */
export let stoppedBy = (said: string[]): boolean =>
  said.reduce((out, text) => {
    let word = keyword(text, out)
    return word == 'stop' ? true : word == 'start' ? false : out
  }, false)

/**
 * Whether a text reached the number that sent it. Nobody wrote it to that
 * number: it is the line's own text coming back, and an answer to it would
 * come back the same way, so a host that answers texts leaves it unread.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { echo } from '@yaks/phone'
 * equal(echo({ from: '+12695550100', to: '+12695550100' }), true)
 * equal(echo({ from: '+12695550142', to: '+12695550100' }), false)
 * ```
 */
export let echo = (text: Pick<Arrival, 'from' | 'to'>): boolean =>
  !!text.from && text.from == text.to
