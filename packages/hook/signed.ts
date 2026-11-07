// Whether a delivered request is signed by whoever holds the secret.
//
// A scheme is data, so the receiver can keep it beside the secret it names:
// `'stripe'`, `'github'`, `'telnyx'`, `'standard'` (Standard Webhooks, as
// OpenAI signs), an HMAC-SHA256 of the raw body in a
// header of the sender's choosing, or an Ed25519 signature over a timestamp
// and the body, checked under the sender's public key. The answer is a sentence: '' when the signature holds,
// else why it does not, because a refusal someone reads in a log should say
// what was wrong rather than only that something was.
//
// The body is the RAW body, the exact string that arrived: a signature covers
// bytes, and parsing then re-serializing would verify something the sender
// never signed. Every compare runs through WebCrypto's `verify`, so it is
// constant-time without a compare of our own.
//
// What secret to use, and what a refusal means for the request, are the
// receiver's to say. This module never learns where a secret came from, but it
// does say which refusal can be the receiver's own fault (`ours`): a sender
// holding the secret always sends a complete, fresh, well-formed signature, so
// only one of those that fails to match can mean the receiver's secret is
// wrong. Anything short of that (no header, no timestamp, a stale one, a digest
// that is not a SHA-256) is the caller's own bad input, which anyone on the
// internet can send, and is refused without anybody being told.

import { header, type Request } from './hooked.ts'

/** An HMAC-SHA256 of the raw body, in the named header. */
export type Hmac = {
  /** the header carrying the signature */
  header: string
  /** what precedes the digest in the header, such as `sha256=` */
  prefix?: string
  /** how the digest is written: hex (the default) or base64 */
  encoding?: 'hex' | 'base64'
}

/** An Ed25519 signature over `<timestamp><join><raw body>`, base64 in one
 * header, the timestamp (unix seconds) in another. The secret it is checked
 * under is the sender's public key, base64. */
export type Ed25519 = {
  /** the header carrying the signature */
  signature: string
  /** the header carrying the unix time it was signed */
  timestamp: string
  /** what stands between the timestamp and the body in what was signed */
  join: string
}

/** A provider that authenticates with a secret header rather than a signature. */
export type SecretHeader = { header: string; token: true }

/** Signature verification or bearer-secret authentication, specified as data. */
export type Scheme =
  | 'stripe'
  | 'github'
  | 'telnyx'
  | 'standard'
  | Hmac
  | Ed25519
  | SecretHeader

/** Where a signature's header is read from: a fetch `Headers` is one. */
export type HeaderLookup = { get(name: string): string | null }

// How far a Stripe signature's timestamp may be from now, in seconds. Stripe's
// own libraries default to five minutes, and the point of the timestamp is
// that a body captured off the wire cannot be replayed later under its own
// signature.
export let SKEW = 300

// The one refusal a receiver holding the wrong secret would see.
let MISMATCH = 'the signature does not match'
let MALFORMED = 'the signature is not well formed'

let GITHUB: Hmac = { header: 'X-Hub-Signature-256', prefix: 'sha256=' }
// https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks
let TELNYX: Ed25519 = {
  signature: 'telnyx-signature-ed25519',
  timestamp: 'telnyx-timestamp',
  join: '|',
}

let enc = new TextEncoder()

let hex = (s: string) => {
  if (!/^[0-9a-f]+$/i.test(s) || s.length % 2) return null
  let out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

let base64 = (s: string) => {
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

let key = (secret: string | Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey(
    'raw',
    typeof secret == 'string' ? enc.encode(secret) : secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )

// Why none of these digests is the HMAC of the payload, or '' when one is. A
// digest that is not 32 bytes cannot be a SHA-256 and is simply skipped: it
// must never throw its way past the check, and when none is well formed there
// is nothing to take the secret out for.
let matches = async (
  secret: string | Uint8Array<ArrayBuffer>,
  payload: string,
  digests: (Uint8Array<ArrayBuffer> | null)[],
) => {
  let sent = digests.filter((d) => d?.length == 32) as Uint8Array<ArrayBuffer>[]
  if (!sent.length) return MALFORMED
  let k = await key(secret)
  let bytes = enc.encode(payload)
  for (let d of sent) {
    if (await crypto.subtle.verify('HMAC', k, d, bytes)) return ''
  }
  return MISMATCH
}

// The Stripe header as its pairs, in order. A Map would not do: a header
// carries several `v1=` signatures while a secret is being rolled, and every
// one of them has to be tried.
let pairs = (line: string) =>
  line.split(',').map((p) => {
    let at = p.indexOf('=')
    return at < 0
      ? ['', p.trim()]
      : [p.slice(0, at).trim(), p.slice(at + 1).trim()]
  })

// A provider that sends a bearer secret in a header (Pinnacle). Compare
// through WebCrypto, just as digests are compared, before the body is decoded.
let bearer = async (
  scheme: SecretHeader,
  secret: string,
  headers: HeaderLookup,
) => {
  let sent = headers.get(scheme.header)
  if (!sent) return `no ${scheme.header} header`
  let k = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  let digest = await crypto.subtle.sign('HMAC', k, enc.encode(secret))
  return await crypto.subtle.verify('HMAC', k, digest, enc.encode(sent))
    ? ''
    : MISMATCH
}

// Stripe: `t=<unix>,v1=<hex>` over `<t>.<raw body>`.
let stripe = async (
  secret: string,
  body: string,
  headers: HeaderLookup,
  now: number,
) => {
  let line = headers.get('Stripe-Signature')
  if (!line) return 'no Stripe-Signature header'
  let said = pairs(line)
  let t = Number(said.find(([k]) => k == 't')?.[1])
  if (!Number.isFinite(t)) return 'no timestamp on the signature'
  if (Math.abs(now / 1000 - t) > SKEW) return 'the signature is too old'
  let digests = said.filter(([k]) => k == 'v1').map(([, v]) => hex(v))
  return await matches(secret, `${t}.${body}`, digests)
}

// Standard Webhooks (https://www.standardwebhooks.com): `v1,<base64>` in
// `webhook-signature`, several space apart while a secret is rolled, each an
// HMAC of `<webhook-id>.<webhook-timestamp>.<raw body>` under the secret's
// bytes, the base64 after its `whsec_`.
let standard = async (
  secret: string,
  body: string,
  headers: HeaderLookup,
  now: number,
) => {
  let line = headers.get('webhook-signature')
  if (!line) return 'no webhook-signature header'
  let id = headers.get('webhook-id') ?? ''
  let at = headers.get('webhook-timestamp') ?? ''
  if (!/^\d+$/.test(at)) return 'no timestamp on the signature'
  if (Math.abs(now / 1000 - Number(at)) > SKEW) {
    return 'the signature is too old'
  }
  let raw = base64(secret.replace(/^whsec_/, ''))
  if (!raw?.length) return MISMATCH
  let digests = line.split(' ').flatMap((s) =>
    s.startsWith('v1,') ? [base64(s.slice(3))] : []
  )
  return await matches(raw, `${id}.${at}.${body}`, digests)
}

let hmac = async (
  scheme: Hmac,
  secret: string,
  body: string,
  headers: HeaderLookup,
) => {
  let line = headers.get(scheme.header)
  if (!line) return `no ${scheme.header} header`
  let prefix = scheme.prefix ?? ''
  if (!line.startsWith(prefix)) return MALFORMED
  let digest = line.slice(prefix.length).trim()
  let decoded = scheme.encoding == 'base64' ? base64(digest) : hex(digest)
  return await matches(secret, body, [decoded])
}

// Ed25519: a 64-byte signature over `<t><join><raw body>`, `t` within SKEW of
// now, under a 32-byte public key. A key that is not one is the receiver's own
// mistake, so it reads as a mismatch.
let ed25519 = async (
  scheme: Ed25519,
  publicKey: string,
  body: string,
  headers: HeaderLookup,
  now: number,
) => {
  let line = headers.get(scheme.signature)
  if (!line) return `no ${scheme.signature} header`
  let at = headers.get(scheme.timestamp) ?? ''
  if (!/^\d+$/.test(at)) return 'no timestamp on the signature'
  if (Math.abs(now / 1000 - Number(at)) > SKEW) {
    return 'the signature is too old'
  }
  let sent = base64(line.trim())
  if (sent?.length != 64) return MALFORMED
  let raw = base64(publicKey)
  if (raw?.length != 32) return MISMATCH
  let k = await crypto.subtle.importKey('raw', raw, 'Ed25519', false, [
    'verify',
  ])
  let ok = await crypto.subtle.verify(
    'Ed25519',
    k,
    sent,
    enc.encode(`${at}${scheme.join}${body}`),
  )
  return ok ? '' : MISMATCH
}

/**
 * Why a request is not signed under this scheme and secret, or '' when it is.
 *
 * ```ts
 * import { refusal } from '@yaks/hook'
 * await refusal('github', 'a secret', '{}', new Headers())
 * // 'no X-Hub-Signature-256 header'
 * ```
 */
export let refusal = (
  scheme: Scheme,
  secret: string,
  body: string,
  headers: HeaderLookup,
  now: number = Date.now(),
): Promise<string> =>
  scheme == 'stripe'
    ? stripe(secret, body, headers, now)
    : scheme == 'telnyx'
    ? ed25519(TELNYX, secret, body, headers, now)
    : scheme == 'standard'
    ? standard(secret, body, headers, now)
    : typeof scheme == 'object' && 'token' in scheme
    ? bearer(scheme, secret, headers)
    : scheme != 'github' && 'timestamp' in scheme
    ? ed25519(scheme, secret, body, headers, now)
    : hmac(scheme == 'github' ? GITHUB : scheme, secret, body, headers)

/**
 * Whether a {@link refusal} can mean the receiver's own secret is wrong, and so
 * is worth reporting: only a complete, fresh, well-formed signature that does
 * not match. Every other refusal is the caller's own bad input.
 *
 * ```ts
 * import { ours, refusal } from '@yaks/hook'
 * ours(await refusal('stripe', 'a secret', '{}', new Headers())) // false
 * ```
 */
export let ours = (why: string): boolean => why == MISMATCH

/**
 * A captured request with its `verified` set by checking it under this scheme
 * and secret, ready for {@link hooked}.
 */
export let checked = async (
  r: Request,
  scheme: Scheme,
  secret: string,
  now: number = Date.now(),
): Promise<Request> => ({
  ...r,
  verified: await refusal(scheme, secret, r.body ?? '', {
    get: (name) => header(r, name) ?? null,
  }, now) == '',
})
