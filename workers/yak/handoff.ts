// Custom-domain sign-in handoff (T-33037), as pure logic — identity.ts wires
// it to a request. The platform authenticates a person, then hands the
// customer's OWN hostname a one-time token it spends here for a host-only
// cookie of its own, because the platform cookie is `yaks.app`'s and never
// rides to `herbusiness.com`. The token is bound to the person AND the exact
// host, minted only for a directory-verified customer hostname, spent once, and
// dead in a minute — so it can neither be replayed to another host, made to
// name another person, nor used twice. No Cloudflare provider import lives here
// (unlike identity.ts), so this contract is unit-testable on its own; the
// handler there adds only the cookie and the redirect.
import { opened, seal } from '../../src/token.ts'
import { foreign } from './route.ts'

// The path a customer's own hostname answers the handoff at. Namespaced so an
// app's own routes do not collide with it.
export let HANDOFF = '/__yak/signin'
export let HANDOFF_LIFE = 60
export type Hand = { person: string; host: string; jti: string; exp: number }

// A directory, just enough to verify a hostname is a customer's (directory.ts
// `serves`: the hostname's app and space, or null for one never attached).
type Serves = { serves: (host: string) => Promise<unknown> }

// The handoff URL for a return on a customer's own hostname, or null when
// `back` is not one the directory vouches for — the one guard between a token
// and a stranger's domain, an open redirect closed by verifying the
// destination rather than trusting the field. `onZone` stays pure and
// synchronous; this is the async, verified path beside it.
export let handoffTo = async (
  secret: string,
  dir: Serves,
  person: string,
  back: string,
  now = Date.now(),
): Promise<string | null> => {
  let url
  try {
    url = new URL(back)
  } catch {
    return null
  }
  let host = url.hostname.toLowerCase()
  if (url.protocol != 'https:' || !foreign(host)) return null
  if (!await dir.serves(host)) return null
  let hand: Hand = {
    person,
    host,
    jti: crypto.randomUUID(),
    exp: Math.floor(now / 1000) + HANDOFF_LIFE,
  }
  let to = new URL(`https://${host}${HANDOFF}`)
  to.searchParams.set('t', await seal(hand, secret))
  to.searchParams.set('next', safeNext(url.pathname + url.search))
  return to.href
}

// A same-host relative path only: a scheme or a `//host` is coerced to '/', so
// the handoff cannot be bent into a second open redirect off the app's domain.
export let safeNext = (next: string) =>
  next.startsWith('/') && !next.startsWith('//') ? next : '/'

// The person a valid token names, or null. Valid means: written under this
// secret, unexpired, minted for THIS host, and not already spent. `spend`
// records the jti and answers false if it was already spent (single use); it is
// injected so the store is the caller's (KV) and the test's (a map). It runs
// LAST, so a token that fails any other check is never consumed.
export let opener = async (
  t: string,
  secret: string,
  host: string,
  spend: (jti: string) => Promise<boolean>,
  now = Date.now(),
): Promise<string | null> => {
  let h = await opened<Hand>(t, secret)
  let sec = Math.floor(now / 1000)
  if (
    !h || typeof h.person != 'string' || typeof h.jti != 'string' ||
    typeof h.exp != 'number' || h.exp <= sec || h.host != host.toLowerCase()
  ) return null
  return await spend(h.jti) ? h.person : null
}

// The single-use ledger over a KV: a spent jti is written with a life just past
// the token's own, so a replay inside the window finds it already there. KV's
// TTL sweeps it; nothing here has to. Absent a KV (a probe with none wired),
// the host/person binding and the minute-long life still stand between a leaked
// URL and a session.
export let spender = (kv: unknown) => async (jti: string): Promise<boolean> => {
  let store = kv as {
    get(k: string): Promise<string | null>
    put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>
  } | undefined
  if (!store?.get) return true
  let k = `handoff:${jti}`
  if (await store.get(k)) return false
  await store.put(k, '1', { expirationTtl: HANDOFF_LIFE + 5 })
  return true
}
