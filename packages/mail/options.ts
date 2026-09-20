// What a config says TO this plugin, in one place, because all three of its
// facets read it: `./rules` takes the domain, `./effects` takes the transport,
// `./routes` takes the door. One options vocabulary, one file — a facet that
// owned the type would own fields it never reads.
//
// ```json
// { "use": "@yaks/mail",
//   "with": { "domain": "books.example",
//             "sender": { "via": "cloudflare",
//                         "account": "…",
//                         "token": { "env": "CF_EMAIL_TOKEN" } },
//             "door": { "secret": { "env": "MAIL_DOOR_SECRET" },
//                       "triage": "…" } } }
// ```
//
// Nothing here holds a secret: `{"env": "NAME"}` anywhere in the object is the
// environment's value at the moment the config is read (@yaks/cli), so the file
// is committable and the token is not in it.

import type { Eid } from '@yaks/graph'

/** What a config says to @yaks/mail. */
export type Options = {
  /** your own mail domain — the addresses this graph canonicalizes on write */
  domain?: string
  /** whether `domain` is this GRAPH's namespace rather than a mail server's:
   * a letter to an address there is delivered by writing it, never handed to
   * the transport. True where the addresses at your domain ARE entities here
   * (an agent, a project); false where somebody reads them in a mail client. */
  local?: boolean
  /** the transport outbound letters go through; none, and none go */
  sender?: Transport
  /** where letters arrive, and who may hand this graph one */
  door?: Door
}

/** A transport, as a config names one. */
export type Transport =
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

/** The arrival door: where a mail edge posts a letter, and what it must show. */
export type Door = {
  /** the path it answers on (default `/mail/inbound`) */
  path?: string
  /** the bearer token a poster must present. Name none and the door is as open
   * as the `/apply` beside it — right for a box behind a perimeter, wrong for
   * anything reachable from the internet. */
  secret?: string
  /** where a letter addressed to nobody this graph knows lands — the triage
   * pile. None, and such a letter is recorded aimed at nothing. */
  triage?: Eid
}
