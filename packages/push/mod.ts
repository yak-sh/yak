// Web Push (RFC 8030): what a browser hands a site when a person allows its
// notifications, and sending a message to it. Each message is encrypted for
// that one browser (RFC 8291, aes128gcm) and signed with the site's VAPID key
// (RFC 8292), here and nowhere else; the push service the subscription names
// carries it to the browser.
import { identityEid } from '@yaks/graph/identity'

/** What a browser's `PushSubscription.toJSON()` holds: where to push, and
 * the browser's public key and secret a message is encrypted with. */
export type Subscription = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** A site's VAPID identity: its P-256 private key as a JWK (`vapidKey`), and
 * a `mailto:` or `https:` address a push service may contact. */
export type Vapid = { key: JsonWebKey; subject: string }

/** How a push went: carried, or gone because the browser took back its
 * subscription (the service answered 404 or 410) and nothing reaches it. */
export type Pushed = 'sent' | 'gone'

/** A push service refused a message for a reason other than a dead
 * subscription. */
export class Unpushed extends Error {
  status: number
  constructor(status: number, why: string) {
    super(`The push service answered ${status}${why ? `: ${why}` : ''}`)
    this.status = status
  }
}

let enc = new TextEncoder()

/** Bytes as unpadded base64url, the encoding every Web Push key travels in. */
export let base64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

/** The bytes of unpadded or padded base64url. */
export let bytesOf = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(
    atob(text.replaceAll('-', '+').replaceAll('_', '/')),
    (c) => c.charCodeAt(0),
  )

let concat = (...parts: Uint8Array[]) => {
  let out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}

let P256 = { name: 'ECDH', namedCurve: 'P-256' } as const

/** A new VAPID private key, as the JWK a site keeps secret. */
export let vapidKey = async (): Promise<JsonWebKey> => {
  let pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  return crypto.subtle.exportKey('jwk', pair.privateKey)
}

/**
 * The public half of a VAPID key, as a page passes it to
 * `pushManager.subscribe({ applicationServerKey })`: the uncompressed P-256
 * point, base64url.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { bytesOf, publicKey, vapidKey } from '@yaks/push'
 * let key = bytesOf(publicKey(await vapidKey()))
 * equal([key.length, key[0]], [65, 4])
 * ```
 */
export let publicKey = (key: JsonWebKey): string =>
  base64url(concat(new Uint8Array([4]), bytesOf(key.x!), bytesOf(key.y!)))

/**
 * Whether `value` is a subscription a message can be sent to: an `https:`
 * endpoint, a P-256 public key and a 16-byte secret.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { isSubscription } from '@yaks/push'
 * equal(isSubscription({ endpoint: 'http://push.example', keys: {} }), false)
 * ```
 */
export let isSubscription = (value: unknown): value is Subscription => {
  let sub = value as Subscription | null
  try {
    return new URL(sub!.endpoint).protocol == 'https:' &&
      bytesOf(sub!.keys.p256dh).length == 65 &&
      bytesOf(sub!.keys.auth).length == 16
  } catch {
    return false
  }
}

/** The eid of a browser's `push_subscription` row, derived from its
 * endpoint, so a browser subscribing again is the same row. */
export let subscriptionEid = (endpoint: string): string =>
  identityEid('push_subscription', [endpoint])

// HKDF-SHA-256, extract and expand at once.
let hkdf = async (
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
) =>
  new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
      bytes * 8,
    ),
  )

/** The content key and nonce of one aes128gcm message (RFC 8291 §3.4),
 * from the ECDH secret, the browser's auth secret, both public keys and the
 * message's salt. Sender and browser each derive them. */
export let messageKeys = async (
  secret: Uint8Array<ArrayBuffer>,
  auth: Uint8Array<ArrayBuffer>,
  browser: Uint8Array,
  server: Uint8Array,
  salt: Uint8Array<ArrayBuffer>,
): Promise<{ key: CryptoKey; nonce: Uint8Array<ArrayBuffer> }> => {
  let info = concat(enc.encode('WebPush: info\0'), browser, server)
  let ikm = await hkdf(auth, secret, info, 32)
  let cek = await hkdf(
    salt,
    ikm,
    enc.encode('Content-Encoding: aes128gcm\0'),
    16,
  )
  return {
    key: await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]),
    nonce: await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12),
  }
}

/** The ECDH secret between a private key and a raw public point. */
export let shared = async (
  own: CryptoKey,
  other: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'ECDH',
        public: await crypto.subtle.importKey('raw', other, P256, true, []),
      },
      own,
      256,
    ),
  )

// The one record a message fits in: its size, and what is left of it for
// words once the header, the delimiter and the tag are taken.
let RECORD = 4096
/** The most bytes of payload one push carries. */
export let MOST = RECORD - 16 - 1 - 86

// `payload` encrypted for the browser of `sub`, as an aes128gcm body.
let sealed = async (sub: Subscription, payload: Uint8Array) => {
  let browser = bytesOf(sub.keys.p256dh)
  let pair = await crypto.subtle.generateKey(P256, true, ['deriveBits'])
  let server = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey),
  )
  let salt = crypto.getRandomValues(new Uint8Array(16))
  let { key, nonce } = await messageKeys(
    await shared(pair.privateKey, browser),
    bytesOf(sub.keys.auth),
    browser,
    server,
    salt,
  )
  let body = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    concat(payload, new Uint8Array([2])),
  )
  let header = new Uint8Array(21)
  header.set(salt)
  new DataView(header.buffer).setUint32(16, RECORD)
  header[20] = server.length
  return concat(header, server, new Uint8Array(body))
}

// The VAPID token for one push service, good for twelve hours.
let token = async (vapid: Vapid, endpoint: string, now: number) => {
  let part = (o: object) => base64url(enc.encode(JSON.stringify(o)))
  let unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${
    part({
      aud: new URL(endpoint).origin,
      exp: Math.floor(now / 1000) + 12 * 3600,
      sub: vapid.subject,
    })
  }`
  let { d, x, y } = vapid.key
  let key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d, x, y },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  let signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(unsigned),
  )
  return `${unsigned}.${base64url(signature)}`
}

/** The request that pushes `payload` to `sub`, encrypted and signed: a
 * message the browser keeps for up to `ttl` seconds while it is offline. */
export let pushRequest = async (
  sub: Subscription,
  payload: string,
  vapid: Vapid,
  { ttl = 86400, now = Date.now() }: { ttl?: number; now?: number } = {},
): Promise<Request> => {
  let bytes = enc.encode(payload)
  if (bytes.length > MOST) {
    throw new RangeError(`A push carries at most ${MOST} bytes`)
  }
  return new Request(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${await token(vapid, sub.endpoint, now)}, k=${
        publicKey(vapid.key)
      }`,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(ttl),
    },
    body: await sealed(sub, bytes),
  })
}

/** Push `payload` to `sub` through `send`: `sent` once the service took it,
 * `gone` when the subscription is dead, and {@link Unpushed} otherwise. */
export let push = async (
  sub: Subscription,
  payload: string,
  vapid: Vapid,
  send: (request: Request) => Promise<Response> = (r) => fetch(r),
): Promise<Pushed> => {
  let response = await send(await pushRequest(sub, payload, vapid))
  let why = await response.text().catch(() => '')
  if (response.ok) return 'sent'
  if (response.status == 404 || response.status == 410) return 'gone'
  throw new Unpushed(response.status, why.slice(0, 200))
}
