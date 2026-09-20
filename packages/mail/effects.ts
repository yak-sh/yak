// What a host DOES about a letter: the `effects` facet (`@yaks/mail/effects`)
// — one `created(mail)` watch that hands an outbound letter to a sender and
// settles `delivered` or `bounced` back onto it.
//
// The sender is the reason this facet takes OPTIONS. Handing a letter over
// needs a transport — an account, a token, an endpoint — and none of that is a
// fact about the graph, so the config names it beside the plugin and the
// factory builds it here:
//
// ```json
// { "use": "@yaks/mail",
//   "with": { "domain": "books.example",
//             "sender": { "via": "cloudflare",
//                         "account": "…",
//                         "token": { "env": "CF_EMAIL_TOKEN" } } } }
// ```
//
// A host that names no sender gets no watch, which is exactly what a graph
// that only RECEIVES mail wants — not a letter sitting outbound forever
// against a transport nobody configured.

import type { Watch } from '@yaks/effects'
import { MAIL } from './comp.ts'
import type { Sender } from './send.ts'
import { sending } from './send.ts'
import { cloudflare } from './cloudflare.ts'
import { stash } from './stash.ts'

/** What a config says to this plugin. */
export type Options = {
  /** your own mail domain — the addresses this graph canonicalizes on write */
  domain?: string
  /** the transport outbound letters go through; none, and none go */
  sender?: Post
}

/** A transport, as a config names one. */
export type Post =
  | {
    /** Cloudflare Email Sending */
    via: 'cloudflare'
    /** the Cloudflare account id */
    account: string
    /** an API token that may send mail — `{"env": "…"}` in the config */
    token: string
    /** the API root, to aim a probe at a stub */
    base?: string
  }
  | {
    /** the sender that keeps letters in memory: a development box */
    via: 'stash'
  }

/** A named transport, built. An unknown `via` is a refusal: a host that
 * thinks it is sending mail and is not is worse than one that will not boot. */
export let post = (said: Post): Sender => {
  if (said.via == 'stash') return stash()
  if (said.via == 'cloudflare') {
    if (!said.account || !said.token) {
      throw new Error(
        '@yaks/mail: a cloudflare sender needs `account` and `token`',
      )
    }
    return cloudflare(said)
  }
  throw new Error(
    `@yaks/mail: no sender called ${JSON.stringify((said as Post).via)}`,
  )
}

/** The outbound half: `created(mail)`, where a sender was named. */
export let effects = (_host: unknown, options: Options = {}): Watch[] =>
  options.sender
    ? [{
      comp: MAIL,
      created: sending({ sender: post(options.sender) }),
      doc: 'hand an outbound letter to the sender and settle its outcome',
    }]
    : []
