// The platform session token (D-32318 §Auth): what the kernel worker trusts
// about who is asking, minted once at sign-in and verified on every request
// with no session store and no round trip. A token is `<claims>.<mac>`: the
// claims are base64url JSON `{person, space, exp}` — the person's eid, the
// space the sign-in happened at (null for the platform-wide door), and a unix
// second the token dies at — and the mac is HMAC-SHA256 over the claims text
// under the session's own key. An edited or forged token fails the mac, an old
// one fails `exp`. WebCrypto authenticates a seal when signing or verifying;
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
// The protocol itself is @yaks/secrets/signed's, a use signing under the
// label `yaks.app/<use>`. Nothing here reads a cookie or an env: the kernel's
// session.ts reads the cookie, the login page (T-32327) mints one with `sign`
// and sets it with `cookie`.
import {
  labelKey,
  openedWith,
  secretKey,
  signedWith,
} from '@yaks/secrets/signed'
import { COOKIE, cookieValue } from '@yaks/platform/cookie'
import { oldUse, today } from './token_legacy.ts'

export type Claims = {
  person: string
  space: string | null
  exp: number
  /** The browser this session was signed in from, when it names one. */
  via?: string
}

// The cookie's name. Set on `Domain=yaks.app`, so every space's hostname
// carries it and one sign-in serves the platform.
export { COOKIE, cookieValue }

/** What a sealed value is for: one word per kind of token the kernel mints.
 * A new kind of token is a new word here, never a reuse of an old one. */
export type Use =
  | 'preview' // private draft snapshot, isolated store and expiry
  | 'notice' // an email subscription's confirmation or unsubscribe link
  | 'tracker' // short-lived authorization for one independent tracker store
  | 'session' // the platform cookie (`sign`, `verify` below)
  | 'browser' // a signed-out browser's instrument, never a person
  | 'instrument' // an MCP session's instrument, bound to its signed-in caller
  | 'visit' // an app's worker acting as its visitor (dispatch.ts)
  | 'grant' // the CLI's bearer (grants.ts)
  | 'link' // a sign-in link, once or standing (link.ts)
  | 'handoff' // custom-domain sign-in (handoff.ts)
  | 'handoff-consent' // a person's click to sign in on a custom domain
  | 'consent' // the OAuth consent form (identity.ts)
  | 'erase' // a space's deletion ticket (erase.ts)
  | 'review' // a gallery review ticket (gallery.ts)
  | 'invite' // an invitation's accept link (workers/yak/invite.ts)
  | 'page' // a sandboxed app's page speaking to its own API (installed.ts)
  | 'connect' // a connection's sign-in, on its way back (connections.ts)
  | 'line' // a person's own number's SMS callback (operator-line.ts)
  | 'call' // a call's audio stream, from its ring to its space (operator-calls.ts)
  | 'screen' // a TV's code and the pairing it finds by it (screen.ts)

type Obj = Record<string, unknown>

// The use's own key, under its label. One secret to hold and rotate, and no
// two uses that can verify each other.
let key = (secret: string, use: Use) => labelKey(secret, `yaks.app/${use}`)

// A value nobody but this secret can have written, for this use alone:
// `<body>.<mac>`, the body base64url JSON and the mac HMAC-SHA256 over the
// body text under the use's key. What is sealed is the caller's to shape, and
// its expiry is the caller's to check.
export let seal = async (use: Use, value: unknown, secret: string) =>
  signedWith(await key(secret, use), value)

// What was sealed for this use, and whether it was sealed the way tokens were
// before 2c05d0f6: under the raw secret, accepted only when its claims are
// this use's old shape and no other's (token_legacy.ts, deleted after
// 2027-09-22T20:00Z by T-37927).
let open = async (use: Use, sealed: string, secret: string) => {
  let value = await openedWith<Obj>(await key(secret, use), sealed)
  if (value != null) return { value, legacy: false }
  let old = await openedWith<Obj>(await secretKey(secret), sealed)
  return old != null && oldUse(old) == use
    ? { value: today(use, old), legacy: true }
    : null
}

/** The seal before 2c05d0f6, for a test to mint an old token with. */
export let sealedOld = async (value: unknown, secret: string) =>
  signedWith(await secretKey(secret), value)

// What was sealed, or null for anything but a well-formed value sealed for
// this use under this secret.
export let opened = async <T>(
  use: Use,
  sealed: string,
  secret: string,
): Promise<T | null> => ((await open(use, sealed, secret))?.value as T) ?? null

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
    space: (c.space as string | null) ?? null,
    exp: c.exp,
    ...(typeof c.via == 'string' && c.via ? { via: c.via } : {}),
    ...(o.legacy ? { legacy: true as const } : {}),
  }
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
