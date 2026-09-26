// One call to Stripe, over fetch: the platform's whole Stripe client, which
// billing.ts (a space's plan) and sell.ts (a seller's shop) both speak through,
// and so does the probe that sets up the sandbox the tests sell in.
//
// No SDK: the whole surface used is a few form-encoded POSTs and GETs, and a
// package would be a build step (README §no build step) for less code than
// this.

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
// needs and rides beside it.
let said = (body: unknown, status: number) => {
  let e = (body as { error?: { message?: string; code?: string } })?.error
  return e?.message
    ? `stripe: ${e.message}${e.code ? ` (${e.code})` : ''}`
    : `stripe: HTTP ${status}`
}

// One call. A GET has no body; a POST is form-encoded, which is the only shape
// Stripe's v1 API takes.
//
// `on` is a connected account (sell.ts): the platform key acting on somebody
// else's account, which Stripe reads off the `Stripe-Account` header and
// nothing else — the same key, the same path, a different merchant. It is one
// header rather than a second client because it is one header: a direct charge
// differs from our own only in whose books it lands on.
//
// A call that did not get through — the connection lost on the way, or Stripe
// saying another request held the object (`Stripe-Should-Retry: true`) — is
// asked again, as Stripe's own libraries do, under one `Idempotency-Key`, so a
// write asked twice is one write. {@link TRIES} times in all, a half second
// and then a second apart: a person is waiting on the answer.
export let TRIES = 3
export let ask = async (
  env: { STRIPE_KEY?: string },
  path: string,
  fields?: Record<string, unknown>,
  on?: string,
  method = fields ? 'POST' : 'GET',
) => {
  if (!env.STRIPE_KEY) throw new Error('STRIPE_KEY is not set')
  let body = fields ? new URLSearchParams(form(fields)).toString() : undefined
  let headers = {
    authorization: `Bearer ${env.STRIPE_KEY}`,
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
      if (!r.ok) throw new Error(said(out, r.status))
      return out as Record<string, unknown>
    }
    await r?.body?.cancel()
    await new Promise((go) => setTimeout(go, 500 * n))
  }
}
