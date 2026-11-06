// One call to Stripe, over fetch: the whole Stripe client. It reads no
// environment; whoever calls it lends the key, and the clock its retries wait
// on.
//
// No SDK: the whole surface used is a few form-encoded POSTs and GETs, and an
// SDK would be a build step for less code than this.
import { type Clock, sleep } from '@yaks/fp'

let API = 'https://api.stripe.com'

// Stripe's form encoding: nested keys are `a[b][c]`, and everything is a
// string. Undefined and null are left out rather than sent empty — an empty
// `customer` is not the same ask as no customer at all.
export let form = (
  fields: Record<string, unknown>,
  prefix = '',
): [string, string][] => {
  let out: [string, string][] = []
  for (let [k, v] of Object.entries(fields)) {
    let at = prefix ? `${prefix}[${k}]` : k
    if (v == null) continue
    if (typeof v == 'object') {
      out.push(...form(v as Record<string, unknown>, at))
    } else out.push([at, String(v)])
  }
  return out
}

// A Stripe error as the sentence it gave us. Its own `message` is written for
// a person to read, so it is the one worth keeping; the code is what a log
// needs and rides beside it, and what a caller tells one refusal from another
// by (`code`).
export class StripeError extends Error {
  code?: string
  constructor(body: unknown, status: number) {
    let e = (body as { error?: { message?: string; code?: string } })?.error
    super(
      e?.message
        ? `stripe: ${e.message}${e.code ? ` (${e.code})` : ''}`
        : `stripe: HTTP ${status}`,
    )
    this.code = e?.code
  }
}

// One call. A GET has no body; a POST is form-encoded, which is the only shape
// Stripe's v1 API takes.
//
// `on` is a connected account: the platform key acting on somebody
// else's account, which Stripe reads off the `Stripe-Account` header and
// nothing else — the same key, the same path, a different merchant. It is one
// header rather than a second client because it is one header: a direct charge
// differs from our own only in whose books it lands on.
//
// A call that did not get through — the connection lost on the way, or Stripe
// saying another request held the object (`Stripe-Should-Retry: true`) — is
// asked again, as Stripe's own libraries do, under one `Idempotency-Key`, so a
// write asked twice is one write. {@link TRIES} times in all, a half second
// and then a second apart on the lent clock: a person is waiting on the
// answer.
export let TRIES = 3

/** What a call is made with: the secret key, and the clock retries wait on. */
export type Keyed = { key?: string; clock?: Clock }

export let ask = async (
  at: Keyed,
  path: string,
  fields?: Record<string, unknown>,
  on?: string,
  method = fields ? 'POST' : 'GET',
): Promise<Record<string, unknown>> => {
  if (!at.key) throw new Error('stripe: no key was lent')
  let body = fields ? new URLSearchParams(form(fields)).toString() : undefined
  let headers = {
    authorization: `Bearer ${at.key}`,
    ...(on ? { 'stripe-account': on } : {}),
    ...(method == 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    ...(body == null
      ? {}
      : { 'content-type': 'application/x-www-form-urlencoded' }),
  }
  for (let n = 1;; n++) {
    let last = n == TRIES
    let r = await fetch(`${API}${path}`, { method, headers, body })
      .catch((e) => {
        if (last) throw e
        return null
      })
    if (r && (last || r.headers.get('stripe-should-retry') != 'true')) {
      let out = await r.json().catch(() => null)
      if (!r.ok) throw new StripeError(out, r.status)
      return out as Record<string, unknown>
    }
    await r?.body?.cancel()
    await sleep(500 * n, undefined, at.clock)
  }
}
