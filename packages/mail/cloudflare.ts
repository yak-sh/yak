// Cloudflare Email Sending, as a {@link Sender}.
//
// It is one HTTP call, so this file is a payload shape and a `fetch`. It holds
// no credentials and reads no environment: the account and the token are
// arguments, which is what lets the same code run in a Worker (where secrets
// arrive on `env`), on a server (where they arrive from the process), and in a
// test (where they are made up and the `fetch` is a stub).
//
// The payload's two parts matter. `text` is the body as written; `html` is the
// same body rendered, because a mail client has no base document — a link that
// was relative in the graph reaches the reader as a broken address, which is
// why ./md.ts rejects one. The threading headers carry the bracketed
// Message-ID; the receipt returns the unbracketed one the next reply threads
// on.
//
// A failure says whether the letter left. A fetch that fails while connecting
// never reached the API (Deno names the phase, `client error (Connect)`, for a
// refused connection, a DNS failure and a broken TLS handshake alike), and a
// 429 is the API declining to take it yet. Both reject as `Unsent`, so the
// letter is tried again; anything else may have left, and is a bounce.

import { Unsent } from '@yaks/host/senders'
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
 * A message → the Email Sending payload. Pure, so a test asserts on it without
 * a network anywhere.
 */
export let payload = (m: Message): Payload => ({
  from: { address: m.from, name: m.from.split('@')[0] },
  to: [m.to],
  reply_to: m.from,
  subject: m.subject,
  text: m.text,
  // The builder requires nonempty text or HTML. A subject-only letter has
  // an empty visible body, not an invalid request (T-64121's real probe).
  html: m.html || (m.text ? '' : '<div></div>'),
  ...(m.replyTo
    ? {
      headers: {
        'In-Reply-To': `<${m.replyTo}>`,
        References: `<${m.replyTo}>`,
      },
    }
    : {}),
})

/** The part of `fetch` this file uses — satisfied by the web `fetch` and by a
 * Worker's. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** What the sender needs to reach the account. */
export type Account = {
  /** the Cloudflare account id */
  account: string
  /** an API token that may send mail — never held by this package */
  token: string
  /** the API root, to point a test at a stub (default: the API itself) */
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

let said = (err: unknown) => String((err as Error)?.message ?? err)

// The connect phase, as Deno's fetch names it in the rejection.
let connecting = (err: unknown) => /\(Connect\)/.test(said(err))

// A 429's Retry-After, in seconds, as the wait before the next try.
let wait = (res: Response) => {
  let s = Number(res.headers.get('retry-after'))
  return s > 0 ? s * 1000 : 1000
}

/**
 * One Email Sending request: the API's one client here, for a caller that
 * builds its own {@link Payload} (several recipients, a display name, a
 * Reply-To of its own). It answers the receipt.
 *
 * A failure rejects with the status and the start of the response body, which
 * is what gets written to the letter as `bounced.reason` — so a bounce records
 * what the API reported, not just "send failed". A letter that never reached
 * the API, or that it declined with a 429, rejects as `Unsent` instead.
 */
export let deliver = (
  { account, token, base, fetch: call }: Account,
): (body: Payload) => Promise<Receipt> => {
  let root = (base ?? 'https://api.cloudflare.com/client/v4').replace(
    /\/+$/,
    '',
  )
  let go: Fetch = call ?? fetch
  return async (body: Payload): Promise<Receipt> => {
    let res = await go(`${root}/accounts/${account}/email/sending/send`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }).catch((err) => {
      throw connecting(err) ? new Unsent(`not sent: ${said(err)}`) : err
    })
    let raw = await res.text()
    let answer = parse(raw)
    if (res.status == 429) {
      throw new Unsent(`not sent (HTTP 429): ${raw.slice(0, 200)}`, wait(res))
    }
    if (!res.ok || !answer.success) {
      throw new Error(`send failed (HTTP ${res.status}): ${raw.slice(0, 200)}`)
    }
    let id = String(answer.result?.message_id ?? '').replace(/[<>]/g, '')
    return id ? { id } : {}
  }
}

/**
 * A {@link Sender} over Cloudflare Email Sending: {@link deliver} of the
 * message's {@link payload}.
 *
 * ```ts
 * import { cloudflare } from '@yaks/mail'
 * // in a Worker: cloudflare({ account: env.CF_ACCOUNT, token: env.CF_EMAIL_TOKEN })
 * ```
 */
export let cloudflare = (account: Account): Sender => {
  let post = deliver(account)
  return { send: (message: Message) => post(payload(message)) }
}
