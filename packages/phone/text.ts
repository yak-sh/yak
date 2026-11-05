// Texting's shapes: a text on its way out, one that arrived, what became of
// one that left, and the keywords a person texts to stop or ask for help.
// No provider is named here; ./telnyx.ts and ./voipms.ts are two, given as
// data.

/** One text, composed and ready to leave. */
export type Text = {
  /** the number it goes to, in E.164 form */
  to: string
  /** the words */
  text: string
  /** the number it is from; absent, the sender's own */
  from?: string
  /** an RCS agent to send it as, with the text going as SMS from `from`
   * where the phone has no RCS */
  agent?: string
}

/** What a sender reports about a text it accepted. */
export type Receipt = {
  /** the provider's id for the message, which its outcome names */
  id?: string
}

/** A sender resolves when the text is accepted and rejects when it is not:
 * {@link Blocked} when the carrier will not carry it, through nobody's fault
 * here; {@link Denied} when the provider refused the credentials; any other
 * rejection is a failure. */
export type Sender = { send: (text: Text) => Promise<Receipt> }

/** A text that arrived. */
export type Arrival = {
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
 * the whole text, in any case, with any punctuation around it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { keyword } from '@yaks/phone'
 * equal(keyword(' Stop.'), 'stop')
 * equal(keyword('help'), 'help')
 * equal(keyword('YES'), 'start')
 * equal(keyword('stop the meeting notice'), null)
 * ```
 */
export let keyword = (text: string): Keyword | null =>
  WORDS[text.trim().replace(/^\W+|\W+$/g, '').toUpperCase()] ?? null
