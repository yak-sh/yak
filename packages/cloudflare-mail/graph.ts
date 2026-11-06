// The `@yaks/cloudflare-mail/graph` facet: the sender this plugin lends its
// host, named `cloudflare`, which @yaks/mail selects with
// `sender: {"via": "cloudflare"}`. A config passes it the account and a token
// that may send mail:
//
// ```json
// { "use": "@yaks/cloudflare-mail",
//   "with": { "account": { "secret": "CF_ACCOUNT_ID" },
//             "token": { "secret": "CF_EMAIL_TOKEN" } } }
// ```
//
// The sender reads its options at every letter, so a secret set after
// start-up is used for the next one.
import { afresh, type Sender } from '@yaks/host/senders'
import { type Account, configured } from './sender.ts'

/** What a config passes to @yaks/cloudflare-mail. */
export type Options = Partial<Account>

/** The `cloudflare` sender, built from these options at every letter. */
export let senders = (
  _host: unknown,
  options: Options = {},
): Record<string, Sender> => ({ cloudflare: afresh(() => configured(options)) })
