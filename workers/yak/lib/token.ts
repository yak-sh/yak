// The platform session token (D-32318 §Auth): what the kernel worker trusts
// about who is asking, minted once at sign-in and verified on every request
// with no session store and no round trip. A token is `<claims>.<mac>`: the
// claims are base64url JSON `{person, space, exp}` — the person's eid, the
// space the sign-in happened at (null for the platform-wide door), and a unix
// second the token dies at — and the mac is HMAC-SHA256 over the claims text
// under the session's own key. An edited or forged token fails the mac, an old
// one fails `exp`. WebCrypto's constant-time verify checks a seal; repeat
// opens can reuse that result for the exact seal and key. The role a person
// holds is membership, read from the directory, never a claim: a token
// cannot promote.
//
// The seal under it — `seal`/`opened`, a signed JSON value — is the general
// half, because the session token is not the only thing the kernel has to be
// sure it wrote: the grant an app's own Worker carries back through its
// service binding is another (workers/yak/dispatch.ts), and so are the CLI's
// bearer, a sign-in link, the custom-domain handoff and a letter's tickets.
//
// Every seal names what it is for (`Use`), and every open names the one use
// it accepts. Each use signs under its own key, derived from the one secret,
// so a value sealed for one use fails the mac as any other. Without that,
// anything carrying a person and an expiry was a session: the grant an app's
// worker is handed for every signed-in visitor, set as a cookie, renewed into
// a ninety-day session and minted a standing link (T-37873).
//
// WebCrypto only, so the same file runs in a Worker, in Deno, and in a browser.
// Nothing here reads a cookie or an env: the kernel's session.ts reads the
// cookie, the login page (T-32327) mints one with `sign` and sets it with
// `cookie`.
import { oldUse, today } from './token_legacy.ts'
import { HMAC, hmac, kept } from './hmac.ts'

export type Claims = {
  person: string
  space: string | null
  exp: number
  /** The browser this session was signed in from, when it names one. */
  via?: string
}

// The cookie's name. Set on `Domain=yaks.app`, so every space's hostname
// carries it and one sign-in serves the platform.
export let COOKIE = 'yak_session'

let enc = new TextEncoder()
let dec = new TextDecoder()

let b64u = (bytes: Uint8Array) =>
  bytes.toBase64({ alphabet: 'base64url', omitPadding: true })

let unb64u = (s: string) =>
  Uint8Array.fromBase64(s.replaceAll('-', '+').replaceAll('_', '/'))

/** What a sealed value is for: one word per kind of token the kernel mints.
 * A new kind of token is a new word here, never a reuse of an old one. */
export type Use =
  | 'tracker' // short-lived authorization for one independent tracker store
  | 'session' // the platform cookie (`sign`, `verify` below)
  | 'browser' // a signed-out browser's instrument, never a person
  | 'instrument' // an MCP session's instrument, bound to its signed-in caller
  | 'visit' // an app's worker acting as its visitor (dispatch.ts)
  | 'grant' // the CLI's bearer (grants.ts)
  | 'link' // a sign-in link, once or standing (link.ts)
  | 'handoff' // custom-domain sign-in (handoff.ts)
  | 'consent' // the OAuth consent form (identity.ts)
  | 'erase' // a space's deletion ticket (erase.ts)
  | 'review' // a gallery review ticket (gallery.ts)
  | 'invite' // an invitation's accept link (workers/yak/invite.ts)
  | 'page' // a sandboxed app's page speaking to its own API (installed.ts)
  | 'connect' // a connection's sign-in, on its way back (connections.ts)

// The use's own key: HMAC-SHA256 of the use's name under the secret. One
// secret to hold and rotate, and no two uses that can verify each other.
let key = (secret: string, use: Use) =>
  kept(
    JSON.stringify([use, secret]),
    async () =>
      crypto.subtle.importKey(
        'raw',
        await crypto.subtle.sign(
          'HMAC',
          await hmac(secret),
          enc.encode(`yaks.app/${use}`),
        ),
        HMAC,
        false,
        ['sign', 'verify'],
      ),
  )

let sealWith = async (k: CryptoKey, value: unknown) => {
  let body = b64u(enc.encode(JSON.stringify(value)))
  let mac = await crypto.subtle.sign('HMAC', k, enc.encode(body))
  return `${body}.${b64u(new Uint8Array(mac))}`
}

// Only successful WebCrypto verifications, kept by the immutable key and
// exact seal. Count and length bound the memory per key; the WeakMap lets it
// go with the key. Values and expiry decisions are never kept.
let verified = new WeakMap<CryptoKey, Set<string>>()
let verificationLimit = 256
let sealLimit = 4096

// The value under a mac this key made, or null. A miss uses WebCrypto's
// constant-time verify; a hit reuses its result and parses the value afresh.
let openWith = async (k: CryptoKey, sealed: string) => {
  let dot = sealed.lastIndexOf('.')
  if (dot < 0) return null
  let body = sealed.slice(0, dot)
  try {
    let seen = verified.get(k)
    if (seen?.delete(sealed)) seen.add(sealed)
    else {
      let ok = await crypto.subtle.verify(
        'HMAC',
        k,
        unb64u(sealed.slice(dot + 1)),
        enc.encode(body),
      )
      if (!ok) return null
      if (sealed.length <= sealLimit) {
        seen = verified.get(k)
        if (!seen) verified.set(k, seen = new Set())
        seen.delete(sealed)
        seen.add(sealed)
        if (seen.size > verificationLimit) {
          seen.delete(seen.values().next().value!)
        }
      }
    }
    return JSON.parse(dec.decode(unb64u(body)))
  } catch {
    return null
  }
}

// A value nobody but this secret can have written, for this use alone:
// `<body>.<mac>`, the body base64url JSON and the mac HMAC-SHA256 over the
// body text under the use's key. What is sealed is the caller's to shape, and
// its expiry is the caller's to check.
export let seal = async (use: Use, value: unknown, secret: string) =>
  sealWith(await key(secret, use), value)

// What was sealed for this use, and whether it was sealed the way tokens were
// before 2c05d0f6: under the raw secret, accepted only when its claims are
// this use's old shape and no other's (token_legacy.ts, deleted after
// 2027-09-22T20:00Z by T-37927).
let open = async (use: Use, sealed: string, secret: string) => {
  let value = await openWith(await key(secret, use), sealed)
  if (value != null) return { value, legacy: false }
  let old = await openWith(await hmac(secret), sealed)
  return old != null && oldUse(old) == use
    ? { value: today(use, old), legacy: true }
    : null
}

/** The seal before 2c05d0f6, for a test to mint an old token with. */
export let sealedOld = async (value: unknown, secret: string) =>
  sealWith(await hmac(secret), value)

// What was sealed, or null for anything but a well-formed value sealed for
// this use under this secret.
export let opened = async <T>(
  use: Use,
  sealed: string,
  secret: string,
): Promise<T | null> => (await open(use, sealed, secret))?.value ?? null

export let sign = (claims: Claims, secret: string) =>
  seal('session', claims, secret)

// The claims a session token carries, or null for anything but a well-formed
// session token under this secret that has not expired. `legacy` says it was
// sealed before 2c05d0f6, so the answer carries it re-minted (session.ts
// `slid`). `now` is milliseconds, the clock a test hands in.
export let verify = async (
  token: string,
  secret: string,
  now = Date.now(),
): Promise<(Claims & { legacy?: true }) | null> => {
  let o = await open('session', token, secret)
  let c = o?.value
  if (!o || !c) return null
  if (typeof c.person != 'string' || typeof c.exp != 'number') return null
  if (c.exp * 1000 <= now) return null
  return {
    person: c.person,
    space: c.space ?? null,
    exp: c.exp,
    ...(typeof c.via == 'string' && c.via ? { via: c.via } : {}),
    ...(o.legacy ? { legacy: true as const } : {}),
  }
}

// One cookie's value out of a Cookie header, or null.
export let cookieValue = (header: string | null, name = COOKIE) => {
  for (let part of (header ?? '').split(';')) {
    let [k, ...v] = part.trim().split('=')
    if (k == name) return v.join('=')
  }
  return null
}

// The Set-Cookie value that carries a token: platform-wide by domain, never
// readable by a page's script, sent on top-level navigations from elsewhere
// (Lax) so a link into an app arrives signed in.
//
// An EMPTY domain omits the Domain attribute entirely, which is host-only —
// the cookie sticks to the exact hostname that set it and travels to no other.
// A literal `Domain=` is malformed and a browser's handling of it is its own
// to decide, so the two real cases are named outright: a shared apex, or this
// one host. Custom-domain sign-in (identity.ts `handoff`) needs the host-only
// form, since a `yaks.app` cookie never rides to a customer's own hostname.
export let cookie = (token: string, domain: string, maxAge: number) =>
  `${COOKIE}=${token}; ${domain ? `Domain=${domain}; ` : ''}` +
  `Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`
