// The `@yaks/cloudflare-mail/graph` facet: what this plugin lends its host.
// The sender named `cloudflare`, which @yaks/mail selects with
// `sender: {"via": "cloudflare"}`, sends through the account's REST API. A
// config passes it the account and a token that may send mail:
//
// ```json
// { "use": "@yaks/cloudflare-mail",
//   "with": { "account": { "secret": "CF_ACCOUNT_ID" },
//             "token": { "secret": "CF_EMAIL_TOKEN" } } }
// ```
//
// The sender reads its options at every letter, so a secret set after
// start-up is used for the next one.
//
// A Worker lends the plugin what its runtime holds. Options that name an Email
// Sending `binding` lend a second sender, named `binding`, that sends through
// it, read at each letter; where the deploy holds none, a letter bounces
// saying so.
// And the arrival named `cloudflare` reads a letter Email Routing hands the
// Worker's `email()` as a neutral `Incoming`.
import { afresh, type Arrival, type Sender } from '@yaks/host/senders'
import { type Binding, bound } from './binding.ts'
import type { Inbound } from './receive.ts'
import { type Account, configured } from './sender.ts'

/** What a config passes to @yaks/cloudflare-mail. */
export type Options = Partial<Account> & {
  /** the Workers Email Sending binding the host lends */
  binding?: Binding
}

/** The `cloudflare` sender, built from these options at every letter, and
 * the `binding` sender where the options name a binding. */
export let senders = (
  _host: unknown,
  options: Options = {},
): Record<string, Sender> => ({
  cloudflare: afresh(() => configured(options)),
  ...Object.hasOwn(options, 'binding')
    ? { binding: { send: (m) => bound(options.binding).send(m) } }
    : {},
})

/** The `cloudflare` arrival: Email Routing's delivery, its MIME decoded. */
export let arrivals = (): Record<string, Arrival> => ({
  cloudflare: async (message) =>
    (await import('./receive.ts')).received(message as Inbound),
})
