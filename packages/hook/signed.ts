// Whether a delivered request is signed by whoever holds the secret.
//
// A scheme is data, so the receiver can keep it beside the secret it names:
// `'stripe'`, `'github'`, or an HMAC-SHA256 of the raw body in a header of the
// sender's choosing. The answer is a sentence: '' when the signature holds,
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

/** How a sender signs: a named scheme, or an {@link Hmac} of the body. */
export type Scheme = 'stripe' | 'github' | Hmac

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

let key = (secret: string) =>
  crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )

// Why none of these digests is the HMAC of the payload, or '' when one is. A
// digest that is not 32 bytes cannot be a SHA-256 and is simply skipped: it
// must never throw its way past the check, and when none is well formed there
// is nothing to take the secret out for.
let matches = async (
  secret: string,
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
