// What a config passes to this plugin: the sender's credentials, which
// `./graph` lends the host as the sender named `resend`, and the webhook
// `./routes` takes this sender's signed delivery receipts on.
//
// ```json
// { "use": "@yaks/resend",
//   "with": { "token": { "secret": "RESEND_TOKEN" },
//             "tags": { "yak_host": "box" },
//             "receipts": { "secret": { "secret": "RESEND_WEBHOOK_SECRET" } } } }
// ```
//
// A `{"secret": "NAME"}` is that secret's value when it is read, and the
// sender reads its options at every letter, so a token set after start-up is
// used for the next one.
import type { Resend } from './sender.ts'

/** What a config passes to @yaks/resend. */
export type Options = Partial<Resend> & {
  /** Resend's signed delivery receipts for this graph. A receipt counts only
   * where it carries every one of the sender's `tags`. */
  receipts?: Receipts
}

/** The webhook Resend posts delivery receipts to. */
export type Receipts = {
  /** the endpoint's signing secret, `whsec_…` */
  secret?: string
  /** the path it answers on (default `/mail/resend`) */
  path?: string
}
