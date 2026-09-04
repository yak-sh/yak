// Custom-domain sign-in handoff (handoff.ts): the security contract, as pure
// logic. The platform authenticates, then hands a customer's own hostname a
// one-time token it spends for a host-only cookie. The token is bound to the
// person AND the host, single-use, and short-lived; `opener` refuses every way
// it can be misused, and `handoffTo` mints only for a directory-verified host.
// These functions carry no Cloudflare import, so this suite runs in plain Deno.
import { assertEquals, assertMatch } from '@std/assert'
import { HANDOFF, handoffTo, opener, safeNext, spender } from './handoff.ts'
import { opened, seal } from '../../src/token.ts'

let SECRET = 'handoff-test-secret'
let sec = () => Math.floor(Date.now() / 1000)

// A Map-backed KV standing in for OAUTH_KV: the single-use ledger.
let kv = () => {
  let m = new Map<string, string>()
  return {
    get: (k: string) => Promise.resolve(m.get(k) ?? null),
    put: (k: string, v: string) => (m.set(k, v), Promise.resolve()),
  }
}

let tokenFor = (
  hand: { person: string; host: string; jti?: string; exp?: number },
) => seal({ jti: crypto.randomUUID(), exp: sec() + 60, ...hand }, SECRET)

// A directory that vouches for exactly one customer hostname.
let dir = {
  serves: (host: string) =>
    Promise.resolve(host == 'good.com' ? { name: host } : null),
}

Deno.test('opener: a valid token names its person and is spent', async () => {
  let spend = spender(kv())
  let t = await tokenFor({ person: 'u-1', host: 'good.com' })
  assertEquals(await opener(t, SECRET, 'good.com', spend), 'u-1')
})

Deno.test('opener: expired, tampered, wrong-host, wrong-secret refused', async () => {
  let spend = spender(kv())
  // expired
  assertEquals(
    await opener(
      await tokenFor({ person: 'u-1', host: 'good.com', exp: sec() - 1 }),
      SECRET,
      'good.com',
      spend,
    ),
    null,
  )
  // tampered — signed under another secret
  let bad = await seal({
    person: 'u-1',
    host: 'good.com',
    jti: 'j',
    exp: sec() + 60,
  }, 'other')
  assertEquals(await opener(bad, SECRET, 'good.com', spend), null)
  // wrong host — a token minted for other.com replayed on good.com
  assertEquals(
    await opener(
      await tokenFor({ person: 'u-1', host: 'other.com' }),
      SECRET,
      'good.com',
      spend,
    ),
    null,
  )
})

Deno.test('opener: a token is single-use — a replay is refused', async () => {
  let spend = spender(kv()) // one ledger across both calls
  let t = await tokenFor({ person: 'u-1', host: 'good.com' })
  assertEquals(await opener(t, SECRET, 'good.com', spend), 'u-1') // spent
  assertEquals(await opener(t, SECRET, 'good.com', spend), null) // refused
})

Deno.test('safeNext: only a same-host relative path survives', () => {
  assertEquals(safeNext('/recipes?a=1'), '/recipes?a=1')
  assertEquals(safeNext('https://evil.com'), '/')
  assertEquals(safeNext('//evil.com'), '/')
  assertEquals(safeNext('recipes'), '/')
})

Deno.test('handoffTo: mints only for a directory-verified custom host', async () => {
  // a stranger's host the directory does not vouch for: never
  assertEquals(
    await handoffTo(SECRET, dir, 'u-1', 'https://stranger.com/x'),
    null,
  )
  // our own zone: not a handoff (backTo handles it)
  assertEquals(
    await handoffTo(SECRET, dir, 'u-1', 'https://foo.yaks.app/x'),
    null,
  )
  // not https
  assertEquals(await handoffTo(SECRET, dir, 'u-1', 'http://good.com/x'), null)
  // a verified customer host: a handoff URL whose token is bound to it
  let to = await handoffTo(SECRET, dir, 'u-1', 'https://good.com/recipes?a=1')
  assertMatch(to ?? '', new RegExp(`^https://good\\.com${HANDOFF}\\?t=`))
  let u = new URL(to!)
  assertEquals(u.searchParams.get('next'), '/recipes?a=1')
  let hand = await opened<{ person: string; host: string }>(
    u.searchParams.get('t')!,
    SECRET,
  )
  assertEquals(hand?.person, 'u-1')
  assertEquals(hand?.host, 'good.com')
})
