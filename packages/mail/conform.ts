/// <reference types="@cloudflare/workers-types/index.d.ts" />
// The shapes this package declares are SLICES of the runtime's own types. It
// names them structurally so nothing here depends on Cloudflare at runtime —
// and this file is where that claim is checked, against
// @cloudflare/workers-types itself. Every assertion is an assignment: if the
// runtime's types stop satisfying the slices, the check fails here rather than
// a letter failing to arrive in production.
//
// It is CHECKED ON ITS OWN (`deno task check:workers`) and excluded from the
// repo-wide check, because @cloudflare/workers-types arrives as GLOBALS — the
// package declares them and exports nothing — and those globals merge into
// whatever program includes them, redefining `Response`, `Headers` and friends
// for every other file in it. One file wears them; the rest of the repo
// type-checks against the web.

import type { Head, Received } from './inbound.ts'
import type { Fetch } from './cloudflare.ts'
import { author, cloudflare, inbound, messageId } from './mod.ts'

// The inbound seam: a message an Email Worker is handed IS a `Received`, and
// its headers are a `Head`.
let message = null as unknown as ForwardableEmailMessage
let _received: Received = message
let _head: Head = message.headers

// And the doors, called the way an email() handler calls them.
let _author: string = author(message)
let _id: string = messageId(message)
let _bundles = inbound(message, { text: 'hello' })
let _eid: string = _bundles[0].entity.eid

// The outbound seam: a Worker's own `fetch` is the one the sender calls
// through, so a Worker can hand it in (or leave it to the global).
let _fetch: Fetch = fetch
let _sender = cloudflare({ account: 'a', token: 't', fetch: _fetch })
let _send: (m: {
  from: string
  to: string
  subject: string
  text: string
  html: string
}) => Promise<{ id?: string }> = _sender.send
