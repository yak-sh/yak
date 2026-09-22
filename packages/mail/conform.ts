/// <reference types="@cloudflare/workers-types/index.d.ts" />
// The types this package declares describe only the parts of the runtime's own
// types that it uses. It declares them structurally so nothing here depends on
// Cloudflare at runtime — and this file is where that claim is checked, against
// @cloudflare/workers-types itself. Every assertion is an assignment: if the
// runtime's types stop satisfying ours, the type check fails here rather than
// a letter failing to arrive in production.
//
// It is checked on its own (`deno task check:workers`) and excluded from the
// repo-wide check, because @cloudflare/workers-types arrives as globals — the
// package declares them and exports nothing — and those globals merge into
// whatever program includes them, redefining `Response`, `Headers` and friends
// for every other file in it. This one file includes them; the rest of the
// repo type-checks against the web platform.

import type { Head, Received } from './inbound.ts'
import type { Fetch } from './cloudflare.ts'
import { author, cloudflare, inbound, messageId } from './mod.ts'

// The inbound types: a message an Email Worker is handed is a `Received`, and
// its headers are a `Head`.
let message = null as unknown as ForwardableEmailMessage
let _received: Received = message
let _head: Head = message.headers

// And the exported functions, called the way an email() handler calls them.
let _author: string = author(message)
let _id: string = messageId(message)
let _bundles = inbound(message, { text: 'hello' })
let _eid: string = _bundles[0].entity.eid

// The outbound type: a Worker's own `fetch` is the one the sender calls
// through, so a Worker can pass it in (or leave it to the global).
let _fetch: Fetch = fetch
let _sender = cloudflare({ account: 'a', token: 't', fetch: _fetch })
let _send: (m: {
  from: string
  to: string
  subject: string
  text: string
  html: string
}) => Promise<{ id?: string }> = _sender.send
