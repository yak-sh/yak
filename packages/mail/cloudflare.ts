// Cloudflare Email Sending, as a {@link Sender}.
//
// It is one HTTP call, so this file is a payload shape and a `fetch`. It holds
// NO credentials and reads no environment: the account and the token are
// arguments, which is what lets the same code run in a Worker (where secrets
// arrive on `env`), on a server (where they arrive from the process), and in a
// test (where they are made up and the `fetch` is a stub).
//
// The payload's two parts matter. `text` is the body as written; `html` is the
// same body rendered, because a mail client has no base document — a link that
// was relative in the graph reaches the reader as a broken address, which is
// why ./md.ts refuses one. The threading headers carry the bracketed
// Message-ID; the receipt hands back the unbracketed one the next reply
// threads on.

import type { Message, Receipt, Sender } from './send.ts'

/** The Email Sending payload, as the API takes it. */
export type Payload = {
  /** the sender, with a display name taken from the local part */
  from: { address: string; name: string }
  /** the recipients */
  to: string[]
  /** where a reply should go — the sender, unless you say otherwise */
  reply_to: string
  /** the subject line */
  subject: string
  /** the body as plain text */
  text: string
  /** the body as HTML */
  html: string
  /** the threading headers, present only on a reply */
  headers?: Record<string, string>
}

/**
 * A message → the Email Sending payload. Pure, so it is the seam a test
 * asserts on without a network anywhere.
 */
export let payload = (m: Message): Payload => ({
  from: { address: m.from, name: m.from.split('@')[0] },
  to: [m.to],
  reply_to: m.from,
  subject: m.subject,
  text: m.text,
  html: m.html,
  ...(m.replyTo
    ? {
      headers: {
        'In-Reply-To': `<${m.replyTo}>`,
        References: `<${m.replyTo}>`,
      },
    }
    : {}),
})

/** The slice of `fetch` this file uses — the web one, and a Worker's. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** What the sender needs to reach the account. */
export type Account = {
  /** the Cloudflare account id */
  account: string
  /** an API token that may send mail — never held by this package */
  token: string
  /** the API root, to aim a test at a stub (default: the API itself) */
  base?: string
  /** the fetch to call through (default: the global one) */
  fetch?: Fetch
}

// What the API answers with, as far as this file reads it.
type Answer = { success?: boolean; result?: { message_id?: string } }

let parse = (raw: string): Answer => {
  try {
    return JSON.parse(raw) as Answer
  } catch {
    return {} // a non-JSON error body — the status line carries it
  }
}

/**
 * A {@link Sender} over Cloudflare Email Sending.
 *
 * ```ts
 * import { cloudflare } from '@yaks/mail'
 * // in a Worker: cloudflare({ account: env.CF_ACCOUNT, token: env.CF_EMAIL_TOKEN })
 * ```
 *
 * A failure REJECTS with the status and the first of the body, which is what
 * gets written to the letter as `bounced.reason` — so a bounce says what the
 * API said, not "send failed".
 */
export let cloudflare = (
  { account, token, base, fetch: call }: Account,
): Sender => {
  let root = (base ?? 'https://api.cloudflare.com/client/v4').replace(
    /\/+$/,
    '',
  )
  let go: Fetch = call ?? fetch
  return {
    send: async (message: Message): Promise<Receipt> => {
      let res = await go(`${root}/accounts/${account}/email/sending/send`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload(message)),
      })
      let raw = await res.text()
      let answer = parse(raw)
      if (!res.ok || !answer.success) {
        throw new Error(
          `send failed (HTTP ${res.status}): ${raw.slice(0, 200)}`,
        )
      }
      let id = String(answer.result?.message_id ?? '').replace(/[<>]/g, '')
      return id ? { id } : {}
    },
  }
}
