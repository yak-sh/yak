// The session token's contract: what verifies is exactly what this secret
// signed, unexpired, and nothing else.
import { assertEquals, assertMatch } from '@std/assert'
import {
  cookie,
  cookieValue,
  opened,
  seal,
  sealedOld,
  sign,
  type Use,
  verify,
} from './token.ts'
import { CUT } from './token_legacy.ts'

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

Deno.test('a value sealed for one use opens as no other, a session least', async () => {
  // A grant carries a person and an expiry, which is all a session's claims
  // are: sealed for another use, it still fails the session's mac.
  for (let use of ['visit', 'grant', 'link', 'handoff', 'erase'] as const) {
    let t = await seal(use, claims, secret)
    assertEquals(await verify(t, secret), null)
    assertEquals(await opened(use, t, secret), claims)
  }
  let session = await sign(claims, secret)
  assertEquals(await opened('grant', session, secret), null)
  assertEquals(await opened('session', session, secret), claims)
})

// Every kind's claims as the code before 2c05d0f6 sealed them (token_legacy.ts).
let s = CUT - 60
let OLD: [Use, Record<string, unknown>][] = [
  ['session', { person: 'u-1', space: null, exp: s + 90 * 86_400 }],
  ['session', { person: 'u-1', space: 'jeff', exp: s }],
  ['visit', { store: 'eve/trap', person: 'u-1', role: 'owner', exp: s }],
  ['grant', { id: 'abc', person: 'u-1', space: null, exp: s + 86_400 }],
  ['link', { once: { email: 'a@b.c', code: '123456', back: '/x' } }],
  ['link', { standing: { id: 'abc', person: 'u-1', exp: s + 365 * 86_400 } }],
  ['handoff', { person: 'u-1', host: 'a.example', jti: 'j', exp: s }],
  ['erase', { space: 'sp', person: 'u-1', exp: s * 1000, forever: true }],
  ['review', { app: 'ap', list: true, exp: s * 1000 }],
]
let USES: Use[] = [
  'session',
  'visit',
  'grant',
  'link',
  'handoff',
  'consent',
  'erase',
  'review',
]

Deno.test('a token sealed before 2c05d0f6 opens for its own use and no other', async () => {
  for (let [use, v] of OLD) {
    let t = await sealedOld(v, secret)
    for (let u of USES) {
      let want = u != use ? null : u == 'erase' ? { ...v, exp: s } : v
      assertEquals(await opened(u, t, secret), want, `${use} as ${u}`)
    }
  }
})

Deno.test('an old session verifies, marked for re-minting; other old kinds do not', async () => {
  let was = OLD[0][1]
  let old = await sealedOld(was, secret)
  assertEquals(await verify(old, secret, 0), {
    person: 'u-1',
    space: null,
    exp: was.exp as number,
    legacy: true,
  })
  // The two the audit set as a cookie: a visitor's token, and a grant with
  // its prefix taken off. An erase ticket has a session's keys; its exp is ms.
  for (let [use, v] of OLD) {
    if (use == 'session') continue
    assertEquals(await verify(await sealedOld(v, secret), secret, 0), null)
  }
  // Under the raw secret but no old kind's shape, or past its kind's life.
  for (
    let v of [
      { ...claims, role: 'owner' },
      { person: 'u-1', space: null, exp: CUT + 91 * 86_400 },
      { person: 'u-1', exp: CUT },
    ]
  ) assertEquals(await verify(await sealedOld(v, secret), secret, 0), null)
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
