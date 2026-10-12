/** The portable mail sender capability: a composed message and its receipt.
 * Hosts own sender construction, credentials, metering and lifetime. */

/** One message, composed and ready to leave. */
export type Message = {
  /** the address it is from */
  from: string
  /** the address it is going to */
  to: string
  /** the subject line */
  subject: string
  /** the body as plain text */
  text: string
  /** the same body as HTML */
  html: string
  /** the Message-ID it answers, unbracketed, when it answers one */
  replyTo?: string
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
