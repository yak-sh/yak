// The cookie's life (session.ts): how long a session lasts, and the renewal
// that makes it slide. `SESSION` is ninety days of NOT signing in — an answer
// to a request whose cookie is past half its life carries a fresh one, so
// activity keeps a session for as long as it goes on and only silence ends it
// (T-35380).
//
// Driven directly rather than through workerd: the renewal is one function
// every answer leaves through (index.ts), and what it does with a cookie is
// the whole of it.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import { COOKIE, seal, sealedOld, sign, verify } from './lib/token.ts'
import { CUT } from './lib/token_legacy.ts'
import { GRANT as VISIT, granted, granting } from './dispatch.ts'
import { GRANT, tokenOf } from './grants.ts'
import {
  browserOf,
  browsing,
  minted,
  SESSION,
  slid,
  vouched,
  whoIs,
} from './session.ts'
import { paged, paging } from './installed.ts'

let SECRET = 'a-probe-secret'
let ENV = { SESSION_SECRET: SECRET, APEX: 'yaks.app' }
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

test('a session past half its life is renewed; one still young is not', async () => {
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

// The youngest cookie the old code could have minted; the case is gone once it
// has died (T-37927 deletes it).
let last = CUT + SESSION

test(
  'a cookie sealed before 2c05d0f6 is re-minted on sight, however young',
  async () => {
    let old = await sealedOld({ person: 'p-1', space: null, exp: last }, SECRET)
    let r = await slid(asked(`${COOKIE}=${old}`), ENV, new Response('ok'))
    let fresh = await verify(value(r.headers.get('set-cookie') ?? ''), SECRET)
    assertEquals(fresh?.person, 'p-1')
    assertEquals(fresh?.legacy, undefined)
  },
  { skip: Date.now() >= last * 1000 },
)

test('a session ninety days idle renews nothing', async () => {
  // Day 91: the token fails its own expiry, so there is nobody to renew for
  // (identity.ts `asking` reads the same `verify`) and the browser is signed
  // out.
  let r = await slid(asked(await aged(91)), ENV, new Response('ok'))
  assertEquals(r.headers.get('set-cookie'), null)
})

test('a renewal never speaks over an answer that sets the cookie itself', async () => {
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

test('a token minted for anything else is no session, and renews into none', async () => {
  // The two a stranger can hold (T-37873): the grant an app's worker is handed
  // for every signed-in visitor, and a CLI grant with its prefix taken off.
  // Each names a person and an expiry, and neither is a cookie.
  let exp = Math.floor(Date.now() / 1000) + DAY
  let visit = await granting(SECRET, 'eve/trap', {
    person: 'p-1',
    role: 'owner',
  })
  let cli = (await tokenOf(
    { id: 'a1', person: 'p-1', space: null, exp },
    SECRET,
  )).slice(GRANT.length)
  for (let t of [visit, cli]) {
    let req = asked(`${COOKIE}=${t}`)
    assertEquals(
      await whoIs(req, SECRET, () => Promise.resolve('owner')),
      { person: null, role: null },
    )
    let r = await slid(req, ENV, new Response('ok'))
    assertEquals(r.headers.get('set-cookie'), null)
  }
})

test('a cookie a stranger wrote, and no cookie at all, renew nothing', async () => {
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

test('a browser keeps its instrument when it signs in, without claiming a person before it does', async () => {
  let req = asked('theme=dark')
  let first = await browsing(req, ENV, async (req) => {
    let who = await whoIs(req, SECRET, () => Promise.resolve('owner'))
    assertEquals(who.person, null)
    assertEquals(who.role, null)
    assert(who.via)
    assertEquals(vouched(who), { 'x-yak-via': who.via })
    return Response.json(who)
  })
  let who = await first.json()
  let token = value(first.headers.get('set-cookie')!)
  assertEquals(await verify(token, SECRET), null)
  let browser = asked(`${COOKIE}=${token}`)
  assertEquals((await browserOf(browser, SECRET))?.via, who.via)
  let again = await browsing(
    browser,
    ENV,
    () => Promise.resolve(new Response('ok')),
  )
  assertEquals(again.headers.get('set-cookie'), null)
  let set = await minted(browser, ENV, SECRET, 'p-1')
  let claims = await verify(value(set), SECRET)
  assertEquals([claims?.person, claims?.via], ['p-1', who.via])
  assertEquals(
    (await whoIs(
      asked(`${COOKIE}=${value(set)}`),
      SECRET,
      () => Promise.resolve('owner'),
    )).role,
    'owner',
  )
})

test('an existing session gains a browser instrument and keeps its person and standing', async () => {
  let old = await sign({
    person: 'p-1',
    space: 'garden',
    exp: Math.floor(Date.now() / 1000) + SESSION,
  }, SECRET)
  let first = await browsing(asked(`${COOKIE}=${old}`), ENV, async (req) => {
    let who = await whoIs(req, SECRET, () => Promise.resolve('editor'))
    assertEquals([who.person, who.role], ['p-1', 'editor'])
    assert(who.via)
    return Response.json(who)
  })
  let who = await first.json()
  let claims = await verify(value(first.headers.get('set-cookie')!), SECRET)
  assertEquals([claims?.person, claims?.space, claims?.via], [
    'p-1',
    'garden',
    who.via,
  ])
  assertEquals((await verify(old, SECRET))?.person, 'p-1')
  let req = asked(`${COOKIE}=${old}`)
  assertEquals((await browserOf(req, SECRET))?.via, who.via)
  assertEquals(
    (await whoIs(req, SECRET, () => Promise.resolve('editor'))).via,
    who.via,
  )
  for (let remember of [true, true, false]) {
    let again = await browsing(req, ENV, async (req) => {
      let caller = await whoIs(req, SECRET, () => Promise.resolve('editor'))
      assertEquals([caller.person, caller.role, caller.via], [
        'p-1',
        'editor',
        who.via,
      ])
      return Response.json(caller)
    }, remember)
    let set = again.headers.get('set-cookie')
    if (remember) {
      assert(set)
      assertEquals((await verify(value(set), SECRET))?.via, who.via)
    } else assertEquals(set, null)
    await again.body?.cancel()
  }
  let replacement = await minted(req, ENV, SECRET, 'p-1', 'garden')
  assertEquals((await verify(value(replacement), SECRET))?.via, who.via)
  let other = await sign({
    person: 'p-1',
    space: 'garden',
    exp: Math.floor(Date.now() / 1000) + SESSION - 1,
  }, SECRET)
  let another = await browserOf(asked(`${COOKIE}=${other}`), SECRET)
  assert(another && another.via != who.via)
})

test('forged and expired browser instruments never become a writer', async () => {
  let exp = Math.floor(Date.now() / 1000) + SESSION
  for (
    let token of [
      await seal('browser', { via: 'forged', exp }, 'another-secret'),
      await seal('browser', { via: 'expired', exp: 1 }, SECRET),
      await seal('visit', { via: 'wrong-use', exp }, SECRET),
    ]
  ) {
    let req = asked(`${COOKIE}=${token}`)
    req.headers.set('x-via', 'claimed')
    req.headers.set('x-yak-via', 'claimed')
    assertEquals(await browserOf(req, SECRET), null)
    await browsing(req, ENV, async (req) => {
      let browser = await browserOf(req, SECRET)
      assert(browser)
      assert(
        !['forged', 'expired', 'wrong-use', 'claimed'].includes(browser.via),
      )
      return new Response('ok')
    })
  }
})

test('a page and worker visit preserve a browser instrument without turning it into a person', async () => {
  let who = { person: null, role: null, via: 'browser-1' }
  let token = await granting(SECRET, 'eve/game', who)
  let req = new Request('https://eve.yaks.app/game/api/apply', {
    headers: { [VISIT]: token },
  })
  assertEquals(await granted(req, SECRET, 'eve/game'), who)
  assertEquals(await granted(req, SECRET, 'eve/other'), null)
  let exp = Math.floor(Date.now() / 1000) + SESSION
  let page = await paging(SECRET, 'eve/game', null, exp, who.via)
  assertEquals(await paged(page, SECRET, 'eve/game'), {
    person: null,
    exp,
    via: who.via,
  })
  assertEquals(await paged(page, SECRET, 'eve/other'), null)
  let old = await paging(SECRET, 'eve/game', 'p-1', exp)
  let oldPage = await paged(old, SECRET, 'eve/game')
  assertEquals([oldPage?.person, oldPage?.exp], ['p-1', exp])
  assert(oldPage?.via)
  assertEquals((await paged(old, SECRET, 'eve/game'))?.via, oldPage.via)
  let visit = await granting(SECRET, 'eve/game', {
    person: 'p-1',
    role: 'owner',
  })
  let back = new Request(req, { headers: { [VISIT]: visit } })
  let oldVisit = await granted(back, SECRET, 'eve/game')
  assertEquals([oldVisit?.person, oldVisit?.role], ['p-1', 'owner'])
  assert(oldVisit?.via)
  assertEquals((await granted(back, SECRET, 'eve/game'))?.via, oldVisit.via)
})
