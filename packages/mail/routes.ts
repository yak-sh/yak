// The arrival endpoint: the `@yaks/mail/routes` entry point — the one HTTP
// route a mail edge posts a letter to this graph on.
//
// Mail lands at the edge of the world, in front of a domain, and the graph is
// usually somewhere that edge cannot reach back into. So the letter is posted
// here, as the message itself: the envelope, the headers exactly as they
// arrived, and the body as text once something upstream has parsed the MIME.
// The subject, the Message-ID, the date and the DKIM verdict are read out of
// those headers (./inbound.ts) rather than repeated in the request body — two
// copies of one fact is how they come to disagree.
//
// Who may post is this plugin's option, not a server-wide setting: which
// senders a mailbox trusts is a fact about the mailbox. Set no secret and the
// route is as open as the `/apply` beside it, which is right for a server
// behind a perimeter and wrong for anything else.
//
// Nothing here decides what a letter means. It records one, responds with its
// id, and the effects registered on `mail` do the rest — which is why posting
// the same letter twice needs no lock: the Message-ID already identifies which
// letter this is (./arrive.ts).

import { type Graph, Refused } from '@yaks/graph'
import { json, refuse, type Route, Unauthorized } from '@yaks/api'
import { arrived } from './arrive.ts'
import type { Head } from './inbound.ts'
import type { Options } from './options.ts'

/** The path a letter arrives on, unless the config sets another. */
export let PATH = '/mail/inbound'

/** A letter as it is posted: the message, and what only the poster knows. */
export type Posted = {
  /** the envelope sender — SMTP plumbing; the author is the `From:` header */
  from: string
  /** the address it was delivered to */
  to: string
  /** its headers, as they arrived */
  headers?: Record<string, string>
  /** the body as text, once something has parsed the MIME */
  text?: string
  /** whether the sending domain signed for it, where the receiving MTA told
   * the caller and left no `Authentication-Results` header to read */
  verified?: boolean
}

// Headers as a plain object, read the way a `Headers` is read. A caller sends
// them with whatever capitalization its runtime used, so the lookup is
// case-insensitive.
let head = (said: Record<string, string> = {}): Head => {
  let by = new Map(
    Object.entries(said).map(([k, v]) => [k.toLowerCase(), String(v)]),
  )
  return { get: (name) => by.get(name.toLowerCase()) ?? null }
}

// A constant-time comparison: a secret checked with `==` tells anyone willing
// to time the request how long a prefix they got right. The length still
// leaks, which is why the secret is a token rather than a password.
let same = (a: string, b: string): boolean => {
  if (a.length != b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff == 0
}

let bearer = (request: Request): string =>
  (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')

let said = (body: unknown): Posted => {
  let m = body as Posted | null
  if (!m || typeof m != 'object' || !m.from || !m.to) {
    throw new Refused('a letter arrives as {from, to, headers?, text?}')
  }
  return m
}

/** `POST /mail/inbound` — one letter, as it arrived. */
export let routes = (
  host: { graph: Graph },
  options: Options = {},
): Route[] => {
  let { path = PATH, secret } = options.door ?? {}
  return [{
    method: 'POST',
    path,
    handle: async (request) => {
      try {
        if (secret && !same(secret, bearer(request))) {
          throw new Unauthorized('the arrival endpoint needs a bearer token')
        }
        let { from, to, headers, text, verified } = said(await request.json())
        let receive = arrived({
          graph: host.graph,
          domain: options.domain,
          triage: options.triage,
        })
        let batch = await receive({ from, to, headers: head(headers) }, {
          text,
          ...(verified == null ? {} : { verified }),
        })
        // No bundles: this Message-ID is already here. A caller that cannot
        // tell "recorded" from "recorded earlier" would post it again.
        let landed = batch.length ? await host.graph.apply(batch) : []
        return json({ eid: landed[0]?.entity.eid ?? null })
      } catch (err) {
        return refuse(err, request)
      }
    },
  }]
}
