// What a config passes to this plugin, in one place, because all three of its
// entry points read it: `./rules` reads the domain, `./effects` reads the
// transport, `./routes` reads the HTTP route settings. One options type, one
// file — putting the type in one of those modules would give it fields it
// never reads.
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

/** What a config passes to @yaks/mail. */
export type Options = {
  /** your own mail domain — the addresses this graph canonicalizes on write */
  domain?: string
  /** whether `domain` belongs to this graph rather than to a mail server: a
   * letter to an address there is delivered by writing it, never handed to the
   * transport. True where the addresses at your domain are entities here (an
   * agent, a project); false where somebody reads them in a mail client. */
  local?: boolean
  /** the transport outbound letters go through; with none, none are sent */
  sender?: Transport
  /** where letters arrive, and who may post one to this graph */
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
    /** the API root, to point a test at a stub */
    base?: string
  }
  | {
    /** the sender that keeps letters in memory: a development server */
    via: 'stash'
  }

/** The arrival endpoint: where a mail edge posts a letter, and what it must
 * present. */
export type Door = {
  /** the path it answers on (default `/mail/inbound`) */
  path?: string
  /** the bearer token a caller must present. Set none and the endpoint is as
   * open as the `/apply` beside it — right for a server behind a perimeter,
   * wrong for anything reachable from the internet. */
  secret?: string
  /** where a letter addressed to nobody this graph knows lands — the triage
   * entity. With none, such a letter is recorded with no target. */
  triage?: Eid
}
