// A value nobody but the holder of a secret can have written, exported as
// `@yaks/secrets/signed`: the bearer tokens a server mints and later trusts
// with no store and no round trip. A token is `<body>.<mac>`: the body is
// base64url JSON, the mac HMAC-SHA256 over the body text.
//
// Every token is signed for a label, and every open names the one label it
// accepts. Each label signs under its own key, the HMAC of the label under the
// secret, so one secret serves many kinds of token and a token signed for one
// label fails the mac as any other. What a token carries is the caller's to
// shape, and its expiry is the caller's to check.
//
// WebCrypto only, so the same file runs in a Worker, in Deno, and in a browser.

import { fromBase64url, toBase64url } from '@yaks/fp'

let enc = new TextEncoder()
let dec = new TextDecoder()

/** HMAC-SHA256, the one algorithm every key here is for. */
export let HMAC = { name: 'HMAC', hash: 'SHA-256' }

// Keys made once in an isolate and shared by signing and verification: a key
// is a WebCrypto call or three, and every request with a token needs one. The
// key is kept, not the promise of it, so no request waits on work another
// request started.
let keys = new Map<string, CryptoKey>()

let kept = async (id: string, make: () => Promise<CryptoKey>) => {
  let got = keys.get(id)
  if (!got) keys.set(id, got = await make())
  return got
}

/** The secret's own key, kept apart from every label's key made under it. */
export let secretKey = (secret: string): Promise<CryptoKey> =>
  kept(
    JSON.stringify([secret]),
    () =>
      crypto.subtle.importKey('raw', enc.encode(secret), HMAC, false, [
        'sign',
        'verify',
      ]),
  )

/** The label's own key: HMAC-SHA256 of the label under the secret. */
export let labelKey = (secret: string, label: string): Promise<CryptoKey> =>
  kept(
    JSON.stringify([label, secret]),
    async () =>
      crypto.subtle.importKey(
        'raw',
        await crypto.subtle.sign(
          'HMAC',
          await secretKey(secret),
          enc.encode(label),
        ),
        HMAC,
        false,
        ['sign', 'verify'],
      ),
  )

// Every token a key signed or verified, by its body. Signing is
// deterministic, so a body has one mac under a key: a repeat signs nothing,
// and an open of the exact token reuses the verification. Count and length
// bound the memory per key; the WeakMap lets it go with the key. Values and
// expiry decisions are never kept.
let known = new WeakMap<CryptoKey, Map<string, string>>()
let knownLimit = 256
let tokenLimit = 4096

let remember = (k: CryptoKey, body: string, token: string) => {
  if (token.length > tokenLimit) return
  let seen = known.get(k)
  if (!seen) known.set(k, seen = new Map())
  seen.delete(body)
  seen.set(body, token)
  if (seen.size > knownLimit) seen.delete(seen.keys().next().value!)
}

/** A token for `value` under a key from `labelKey` or `secretKey`. */
export let signedWith = async (
  k: CryptoKey,
  value: unknown,
): Promise<string> => {
  let body = toBase64url(enc.encode(JSON.stringify(value)))
  let token = known.get(k)?.get(body)
  if (!token) {
    let mac = await crypto.subtle.sign('HMAC', k, enc.encode(body))
    token = `${body}.${toBase64url(new Uint8Array(mac))}`
  }
  remember(k, body, token)
  return token
}

/** The value under a mac this key made, or null. A miss uses WebCrypto's
 * constant-time verify; a hit reuses its result and parses the value afresh. */
export let openedWith = async <T = unknown>(
  k: CryptoKey,
  token: string,
): Promise<T | null> => {
  let dot = token.lastIndexOf('.')
  if (dot < 0) return null
  let body = token.slice(0, dot)
  try {
    if (known.get(k)?.get(body) != token) {
      let ok = await crypto.subtle.verify(
        'HMAC',
        k,
        fromBase64url(token.slice(dot + 1)),
        enc.encode(body),
      )
      if (!ok) return null
    }
    remember(k, body, token)
    return JSON.parse(dec.decode(fromBase64url(body)))
  } catch {
    return null
  }
}

/** A token carrying `value`, signed for `label` under `secret`. */
export let signed = async (
  label: string,
  value: unknown,
  secret: string,
): Promise<string> => signedWith(await labelKey(secret, label), value)

/** What a token carries, or null for anything but a well-formed token signed
 * for this label under this secret. */
export let opened = async <T>(
  label: string,
  token: string,
  secret: string,
): Promise<T | null> => openedWith<T>(await labelKey(secret, label), token)

/** What a token says it carries, read without the secret and so unverified:
 * for a client to say whose token it holds and when it dies, never to trust. */
export let claimed = (token: string): unknown => {
  let dot = token.lastIndexOf('.')
  if (dot < 0) return null
  try {
    return JSON.parse(dec.decode(fromBase64url(token.slice(0, dot))))
  } catch {
    return null
  }
}
