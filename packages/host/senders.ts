/** The portable mail sender capability: a composed message and its receipt.
 * Hosts own sender construction, credentials, metering and lifetime. */

/** One message, composed and ready to leave. */
export type Message = {
  /** the caller's letter UUID, for asynchronous delivery receipts */
  id?: string
  /** the address it is from */
  from: string
  /** the name it is from, as the reader's mail shows it beside the address */
  name?: string
  /** the address it is going to */
  to: string | string[]
  /** the address copied on it, who sees it and its replies */
  cc?: string
  /** the subject line */
  subject: string
  /** the body as plain text */
  text: string
  /** the same body as HTML */
  html: string
  /** the Message-ID it answers, unbracketed, when it answers one */
  replyTo?: string
  /** the address replies go to, when different from the sender */
  replyAddress?: string
}

/** What a sender reports about a message it accepted. */
export type Receipt = {
  /** the Message-ID the sender gave the letter, unbracketed, if any */
  id?: string
}

/** A sender resolves when the message is away and rejects when it is not.
 * The rejection's message is what lands in `bounced.reason`, unless it is
 * {@link Unsent}: then the letter is tried again. */
export type Sender = {
  send: (message: Message) => Promise<Receipt>
  /** Why it cannot send yet, such as a credential not set; asked before each
   * letter, so the letter waits instead. Absent or empty, it can send. */
  waiting?: () => string | undefined
}

/** A sender, or why one cannot be built from its options yet. */
export type Built = { sender?: Sender; waiting?: string }

/** A {@link Sender} built again from `build` at every use, so options read
 * then, such as a secret set after start-up, take effect at once. Until it
 * builds, it is {@link Sender.waiting} and a letter handed to it is
 * {@link Unsent}.
 *
 * ```ts
 * import { afresh } from '@yaks/host/senders'
 * import { equal } from '@yaks/testing'
 *
 * let options: { token?: string } = {}
 * let sender = afresh(() =>
 *   options.token
 *     ? { sender: { send: () => Promise.resolve({ id: options.token }) } }
 *     : { waiting: 'waiting for a token' }
 * )
 * equal(sender.waiting?.(), 'waiting for a token')
 * options.token = 't'
 * equal(sender.waiting?.(), undefined)
 * ```
 */
export let afresh = (build: () => Built): Sender => ({
  send: (message) => {
    let { sender, waiting } = build()
    return sender
      ? sender.send(message)
      : Promise.reject(new Unsent(waiting ?? 'waiting for a sender', 60_000))
  },
  waiting: () => build().waiting,
})

/** One text message, composed and ready to leave: the portable texter
 * capability, which @yaks/phone sends through. */
export type Text = {
  /** the number it goes to, in E.164 form */
  to: string
  /** the words */
  text: string
  /** the number it is from; absent, the texter's own */
  from?: string
  /** an RCS agent to send it as, with the text going as SMS from `from`
   * where the phone has no RCS */
  agent?: string
}

/** What a texter reports about a text it accepted. */
export type TextReceipt = {
  /** The transport that accepted it; an opaque provider name. */
  via?: string
  /** the provider's id for the message, which its outcome names */
  id?: string
  /** the number it left from, when the texter chose it */
  from?: string
}

/** A texter resolves when the text is accepted and rejects when it is not,
 * as a {@link Sender} does for a letter. */
export type Texter = {
  send: (text: Text) => Promise<TextReceipt>
  /** Why it cannot send yet, such as a credential not set; asked before each
   * text, so the text waits instead. Absent or empty, it can send. */
  waiting?: () => string | undefined
}

/** A rejection that knows the message never left: the connection was never
 * made, or the provider refused to take it yet. Sending is at most once, so
 * only this rejection lets a letter be handed over again, no sooner than
 * `retry.after` milliseconds; any other rejection is a bounce. */
export class Unsent extends Error {
  retry: { after: number }
  constructor(message: string, after = 1000) {
    super(message)
    this.name = 'Unsent'
    this.retry = { after }
  }
}

/** A rejection that knows the letter as written can never go: its provider
 * refused an address on it, such as one at a domain that takes no mail. The
 * letter bounces with this message as its reason, and that bounce is the
 * letter's outcome, answered on the letter: the writer's input, not a failure
 * of the sender. Any other rejection that is not {@link Unsent} is both. */
export class Undeliverable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Undeliverable'
  }
}

/** An incoming letter at the portable mail boundary. Authentication is a
 * provider's verdict, never inferred from a stranger's supplied headers. */
export type Incoming = {
  /** the name in the message's From header, if any */
  name?: string
  from: string
  to: string
  headers: { get(name: string): string | null }
  text: string
  html?: string
  verified?: boolean
  attachments: { name: string; type: string; bytes: Uint8Array<ArrayBuffer> }[]
}

/** A provider's signed word on a letter it carried: the receipt @yaks/mail's
 * `receipted` applies, if it names one, and the tags the letter was sent
 * with, which say whose letter it was. */
export type Notice = {
  receipt?: { letter: string; id: string }
  tags?: Record<string, string>
}

/** Reads one request a provider posted about the letters it carried. A
 * request the provider did not sign rejects as {@link Unsigned}. */
export type Notices = (request: Request) => Promise<Notice>

/** A request that does not carry its provider's signature: the caller is
 * refused, never retried. */
export class Unsigned extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Unsigned'
  }
}

/** Reads one letter a runtime handed its host, in the runtime's own shape,
 * as an {@link Incoming}. Only the provider knows that shape. */
export type Arrival = (message: unknown) => Promise<Incoming>

/** A DNS record a mail domain needs, and whether its provider has seen it. */
export type DomainRecord = {
  /** `MX`, `TXT` or `CNAME` */
  type: string
  /** the name it is written at, fully qualified */
  name: string
  /** what it holds */
  value: string
  /** an MX record's priority */
  priority?: number
  /** whether the provider has found it in DNS as given */
  arrived: boolean
}

/** A domain a provider sends and receives mail at, and the records it needs. */
export type MailDomain = { name: string; records: DomainRecord[] }

/** A provider's mail domains, each named by its domain name: the provider's
 * own ids for them stay with the provider. Every verb rejects when the
 * provider refuses it, its message naming no secret. */
export type MailDomains = {
  /** Set a domain up for sending and receiving, or answer it as it is when
   * it already is. */
  setup: (name: string) => Promise<MailDomain>
  /** The domain's records as they stand, or none when it is not set up. A
   * read asks the provider to look again for any record not yet arrived. */
  read: (name: string) => Promise<MailDomain | undefined>
  /** Remove the domain; removing one not set up does nothing. */
  remove: (name: string) => Promise<void>
  /** Why it cannot reach the provider yet, such as a credential not set.
   * Absent or empty, it can. */
  waiting?: () => string | undefined
}
