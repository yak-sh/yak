// What a config passes to this plugin: the sender's credentials, which
// `./graph` lends the host as the sender named `resend`, the webhook
// `./routes` takes this sender's signed delivery receipts on, the key
// `./graph` sets up the mail domains it lends as `resend` with, and the key
// its notices read a received letter with.
//
// ```json
// { "use": "@yaks/resend",
//   "with": { "token": { "secret": "RESEND_TOKEN" },
//             "tags": { "yak_host": "box" },
//             "receipts": { "secret": { "secret": "RESEND_WEBHOOK_SECRET" } },
//             "domains": { "token": { "secret": "RESEND_DOMAINS_TOKEN" } },
//             "receiving": { "token": { "secret": "RESEND_DOMAINS_TOKEN" } } } }
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
  /** The mail domains it sets up, reads and removes, through `base` and
   * `fetch` as the sender is. */
  domains?: {
    /** a `full_access` key: a sending key cannot manage domains */ token?:
      string
  }
  /** Mail Resend receives, which the notices read in full for a host that
   * takes mail in. Without it, a received letter is acknowledged unread. */
  receiving?: {
    /** a `full_access` key: a sending key cannot read received mail */ token?:
      string
  }
}

/** The webhook Resend posts delivery receipts to. */
export type Receipts = {
  /** the endpoint's signing secret, `whsec_…` */
  secret?: string
  /** the path it answers on (default `/mail/resend`) */
  path?: string
}
