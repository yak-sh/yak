/** The portable mail sender capability: a composed message and its receipt.
 * Hosts own sender construction, credentials, metering and lifetime. */

/** One message, composed and ready to leave. */
export type Message = {
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
}

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
export type Texter = { send: (text: Text) => Promise<TextReceipt> }

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
