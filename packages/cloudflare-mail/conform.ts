/// <reference types="@cloudflare/workers-types/index.d.ts" />
// The types this package declares describe only the parts of the runtime's own
// types that it uses, structurally, so nothing here depends on Cloudflare at
// runtime. This file is where that claim is checked, against
// @cloudflare/workers-types itself: if the runtime's types stop satisfying
// ours, the type check fails here rather than a letter failing to leave.
//
// `deno task check:types` checks it in the Workers program, apart from Deno's,
// because @cloudflare/workers-types arrives as globals that would redefine
// `Response`, `Headers` and friends for every other file in a program.

import type { Binding } from './binding.ts'
import { cloudflare, type Fetch } from './sender.ts'

// A Worker's own `fetch` is the one the sender calls through, so a Worker can
// pass it in (or leave it to the global).
let _fetch: Fetch = fetch
let _sender = cloudflare({ account: 'a', token: 't', fetch: _fetch })
let _send: (m: {
  from: string
  to: string
  subject: string
  text: string
  html: string
}) => Promise<{ id?: string }> = _sender.send

// The Email Sending binding a Worker is handed is a `Binding`.
let _binding: Binding = null as unknown as SendEmail
