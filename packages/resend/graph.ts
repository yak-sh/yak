// The `@yaks/resend/graph` facet: what this plugin lends its host. The sender
// named `resend`, which @yaks/mail selects with `sender: {"via": "resend"}`,
// the reader of Resend's signed notices about the letters it carried, and the
// mail domains it sets up, each also named `resend`, for a host that routes
// mail itself.
import {
  afresh,
  type MailDomains,
  type Notices,
  type Sender,
} from '@yaks/host/senders'
import { lent } from './domains.ts'
import type { Options } from './options.ts'
import { notification } from './receive.ts'
import { configured } from './sender.ts'

/** The `resend` sender, built from these options at every letter. */
export let senders = (
  _host: unknown,
  options: Options = {},
): Record<string, Sender> => ({ resend: afresh(() => configured(options)) })

/** The `resend` notices, verified with `receipts.secret` as it reads then. */
export let notices = (
  _host: unknown,
  options: Options = {},
): Record<string, Notices> => ({
  resend: (request) => notification(request, options.receipts?.secret),
})

/** The `resend` mail domains, set up with `domains.token` as it reads at
 * each call. */
export let mailDomains = (
  _host: unknown,
  options: Options = {},
): Record<string, MailDomains> => ({
  resend: lent(() => ({
    token: options.domains?.token,
    base: options.base,
    fetch: options.fetch,
  })),
})
