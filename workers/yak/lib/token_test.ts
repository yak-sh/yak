// The session token's contract: what verifies is exactly what this secret
// signed, unexpired, and nothing else.
import { assertEquals, assertMatch } from '@std/assert'
import { cookie, cookieValue, sign, verify } from './token.ts'

let secret = 'a-test-secret'
let claims = { person: 'u-1', space: null, exp: 2_000_000_000 }

Deno.test('a signed token verifies to its claims', async () => {
  let t = await sign(claims, secret)
  assertMatch(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assertEquals(await verify(t, secret), claims)
  assertEquals(
    await verify(await sign({ ...claims, space: 'jeff' }, secret), secret),
    { ...claims, space: 'jeff' },
  )
})

Deno.test('a forged, edited, foreign, or expired token is null', async () => {
  let t = await sign(claims, secret)
  let [body, mac] = t.split('.')
  assertEquals(await verify(t, 'another-secret'), null)
  assertEquals(await verify(`${body}x.${mac}`, secret), null)
  assertEquals(await verify(`${body}.${mac.slice(1)}`, secret), null)
  assertEquals(await verify('not-a-token', secret), null)
  assertEquals(await verify('', secret), null)
  assertEquals(await verify(t, secret, claims.exp * 1000), null)
  let dead = await sign({ ...claims, exp: 1 }, secret)
  assertEquals(await verify(dead, secret), null)
})

Deno.test('the cookie carries the token platform-wide and reads back', () => {
  let c = cookie('tok.en', 'yaks.app', 60)
  assertEquals(
    c,
    'yak_session=tok.en; Domain=yaks.app; Path=/; Max-Age=60; ' +
      'Secure; HttpOnly; SameSite=Lax',
  )
  // An empty domain is host-only: the Domain attribute is omitted entirely
  // (a literal `Domain=` is malformed), so the cookie sticks to the one host
  // that set it — what a custom domain's own session needs (identity.ts).
  assertEquals(
    cookie('tok.en', '', 60),
    'yak_session=tok.en; Path=/; Max-Age=60; Secure; HttpOnly; SameSite=Lax',
  )
  assertEquals(cookieValue('a=1; yak_session=tok.en; b=2'), 'tok.en')
  assertEquals(cookieValue('a=1'), null)
  assertEquals(cookieValue(null), null)
})
