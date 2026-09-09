// The cookie's life (session.ts): how long a session lasts, and the renewal
// that makes it SLIDE. `SESSION` is ninety days of NOT signing in — an answer
// to a request whose cookie is past half its life carries a fresh one, so
// activity keeps a session for as long as it goes on and only silence ends it
// (T-35380).
//
// Driven directly rather than through workerd: the renewal is one function
// every answer leaves through (index.ts), and what it does with a cookie is
// the whole of it.
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import { COOKIE, sign, verify } from '../../src/token.ts'
import { SESSION, slid } from './session.ts'

let SECRET = 'a-probe-secret'
let ENV = { SESSION_SECRET: SECRET }
let DAY = 24 * 60 * 60

// The cookie a browser sends `days` into a ninety-day session.
let aged = async (days: number, person = 'p-1') =>
  `${COOKIE}=${await sign(
    {
      person,
      space: null,
      exp: Math.floor(Date.now() / 1000) + SESSION - days * DAY,
    },
    SECRET,
  )}`

let asked = (cookie: string) =>
  new Request('https://jeff.yaks.app/recipes/api/query', {
    headers: { cookie },
  })

let value = (set: string) => set.slice(`${COOKIE}=`.length, set.indexOf(';'))

Deno.test('a session past half its life is renewed; one still young is not', async () => {
  // Day 46, a day past the half way mark: another ninety days, same person.
  let day46 = await aged(46)
  let renewed = await slid(asked(day46), ENV, new Response('ok'))
  let set = renewed.headers.get('set-cookie') ?? ''
  assertMatch(set, new RegExp(`^${COOKIE}=`))
  assertStringIncludes(set, `Max-Age=${SESSION}`)
  assertStringIncludes(set, 'Domain=yaks.app')
  assert(value(set) != value(day46))
  let claims = await verify(value(set), SECRET)
  assertEquals(claims?.person, 'p-1')
  assert((claims?.exp ?? 0) - Date.now() / 1000 > SESSION - DAY)
  assertEquals(await renewed.text(), 'ok')

  // Day 30, two thirds of it still to run: nothing is set at all.
  let young = await slid(asked(await aged(30)), ENV, new Response('ok'))
  assertEquals(young.headers.get('set-cookie'), null)
})

Deno.test('a session ninety days idle renews nothing', async () => {
  // Day 91: the token fails its own expiry, so there is nobody to renew for
  // (identity.ts `asking` reads the same `verify`) and the browser is signed
  // out.
  let r = await slid(asked(await aged(91)), ENV, new Response('ok'))
  assertEquals(r.headers.get('set-cookie'), null)
})

Deno.test('a renewal never speaks over an answer that sets the cookie itself', async () => {
  // Signing in and the handoff each mint their own (identity.ts `landed`,
  // `handoff`), and a socket has no body to copy.
  let own = `${COOKIE}=their.own; Path=/`
  let signedIn = new Response(null, {
    status: 303,
    headers: { 'set-cookie': own },
  })
  let r = await slid(asked(await aged(46)), ENV, signedIn)
  assertEquals(r.headers.get('set-cookie'), own)
  let socket = new Response(null, { status: 101 })
  assertEquals(await slid(asked(await aged(46)), ENV, socket), socket)
})

Deno.test('a cookie a stranger wrote, and no cookie at all, renew nothing', async () => {
  let forged = await sign(
    { person: 'p-1', space: null, exp: Math.floor(Date.now() / 1000) + DAY },
    'another-secret',
  )
  let r = await slid(asked(`${COOKIE}=${forged}`), ENV, new Response('ok'))
  assertEquals(r.headers.get('set-cookie'), null)
  let bare = await slid(
    new Request('https://jeff.yaks.app/'),
    ENV,
    new Response('ok'),
  )
  assertEquals(bare.headers.get('set-cookie'), null)
})
