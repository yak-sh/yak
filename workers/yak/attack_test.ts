// Sign-in and identity, attacked, held in workerd (T-37872). Each test is one
// hole the 2026-09-22 audit proved on a local kernel, fired again at the
// kernel exactly as it was fired then, beside the traffic that must keep
// working. The root that made most of them reachable is the platform's shape:
// yaks.app is not on the Public Suffix List, so every `<space>.yaks.app` app is
// same-site with the apex, and anybody can serve code from a free space.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../bin/testing.ts'
import { COOKIE, sealedOld, verify } from './lib/token.ts'
import { CUT } from './lib/token_legacy.ts'
import { allowed, type Kernel, kernel, mailed, signIn } from './probe.ts'
import { granting } from './dispatch.ts'
import { SESSION } from './session.ts'

let DAY = 86_400
import { b64u } from './mcp-probe.ts'

// A form a page posts, with the cookie the browser carries and the address
// that browser has in its bar (`from`), or no `Origin` at all.
let posted = (
  k: Kernel,
  path: string,
  fields: Record<string, string>,
  cookie: string,
  from?: string,
) =>
  k.at('yaks.app', path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
      ...(from ? { origin: from } : {}),
    },
    body: new URLSearchParams(fields).toString(),
  })

// An authorize request from a client the attacker registered, aimed home.
let authorizing = async (k: Kernel) => {
  let back = 'https://attacker.invalid/cb'
  let reg = await k.at('yaks.app', '/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: [back],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })
  let { client_id } = await reg.json()
  return new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: back,
    scope: 'graph',
    code_challenge: b64u(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode('v')),
    ),
    code_challenge_method: 'S256',
  }).toString()
}

slow(
  'a token minted for anything but a session is no cookie (T-37873)',
  async () => {
    let k = await kernel()
    try {
      let me = await signIn(k)
      // What an app's worker is handed for every signed-in visitor: sealed by
      // the kernel, naming the person, alive for a minute. Set as the cookie,
      // it must not mint a standing link, the door that turned it into a year.
      let visit = await granting(k.secret, 'eve/trap', {
        person: me.person,
        role: 'owner',
      })
      let mintLink = (cookie: string) =>
        k.at('yaks.app', '/login/link', {
          method: 'POST',
          headers: {
            cookie,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'days=365',
        })
      let stolen = await mintLink(`${COOKIE}=${visit}`)
      assertEquals(stolen.status, 401)
      assertEquals(stolen.headers.get('set-cookie'), null)
      await stolen.body?.cancel()
      // The session itself still mints one.
      let own = await mintLink(me.cookie)
      assertEquals(own.status, 200)
      await own.body?.cancel()
    } finally {
      await k.stop()
    }
  },
)

// The same attack with tokens sealed before 2c05d0f6, which still open for
// their own use (lib/token_legacy.ts): an old visitor's token and an old grant
// with its prefix taken off are no cookie, and an old session cookie still
// signs its person in and comes back re-minted (T-37924).
slow(
  'a token sealed before 2c05d0f6 is a cookie only if it was one (T-37924)',
  async () => {
    let k = await kernel()
    try {
      let me = await signIn(k)
      let mintLink = (token: string) =>
        k.at('yaks.app', '/login/link', {
          method: 'POST',
          headers: {
            cookie: `${COOKIE}=${token}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'days=365',
        })
      let olds = [
        { store: 'eve/trap', person: me.person, role: 'owner', exp: CUT + 60 },
        { id: 'abcdef012345', person: me.person, space: null, exp: CUT + DAY },
      ]
      for (let v of olds) {
        let stolen = await mintLink(await sealedOld(v, k.secret))
        assertEquals(stolen.status, 401)
        assertEquals(stolen.headers.get('set-cookie'), null)
        await stolen.body?.cancel()
      }
      // The youngest session the old code could mint, while it can live.
      if (Date.now() >= (CUT + SESSION) * 1000) return
      let old = await sealedOld(
        { person: me.person, space: null, exp: CUT + SESSION },
        k.secret,
      )
      let own = await mintLink(old)
      assertEquals(own.status, 200)
      await own.body?.cancel()
      let set = own.headers.get('set-cookie') ?? ''
      let fresh = await verify(
        set.slice(`${COOKIE}=`.length, set.indexOf(';')),
        k.secret,
      )
      assertEquals(fresh?.person, me.person)
      assertEquals(fresh?.legacy, undefined)
    } finally {
      await k.stop()
    }
  },
)

slow(
  'forty guesses at a sign-in code at once still get five (T-37875)',
  async () => {
    let k = await kernel()
    try {
      let email = `probe-${crypto.randomUUID().slice(0, 8)}@yaks.app`
      let asked = await posted(k, '/login', { email }, '')
      assertEquals(asked.status, 200)
      await asked.body?.cancel()
      let code = await mailed(k, email)
      let wrong = Array.from(
        { length: 40 },
        (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'),
      )
      let guessed = await Promise.all(
        wrong.map((c) => posted(k, '/login/code', { email, code: c }, '')),
      )
      for (let r of guessed) {
        assertEquals(r.status, 400)
        await r.body?.cancel()
      }
      // Five of those were all the code had, so the right digits open nothing.
      let right = await posted(k, '/login/code', { email, code }, '')
      assertEquals(right.status, 400)
      assertEquals(right.headers.get('set-cookie'), null)
      await right.body?.cancel()
    } finally {
      await k.stop()
    }
  },
)

slow(
  'the consent card says where the authorization goes (T-37877)',
  async () => {
    let k = await kernel()
    try {
      let me = await signIn(k)
      let q = await authorizing(k)
      // Registered as "Claude", sent to the attacker: both are on the card,
      // signed in or not.
      for (let cookie of [me.cookie, '']) {
        let page = await (await k.at('yaks.app', `/oauth/authorize?${q}`, {
          headers: { cookie },
        })).text()
        assertStringIncludes(page, 'Claude (attacker.invalid)')
      }
    } finally {
      await k.stop()
    }
  },
)

slow('a page in another space forges no signed-in form (T-37874)', async () => {
  let k = await kernel()
  try {
    let me = await signIn(k)
    let evil = 'https://eve.yaks.app'
    let q = await authorizing(k)
    // Each form the audit forged from a free space, posted by eve's page with
    // the visitor's cookie riding along: refused before any of them is read.
    let forged: [string, Record<string, string>][] = [
      ['/oauth/allow', { q }],
      [`/space/${me.name}/delete`, { confirm: me.name }],
      ['/login/link', { days: '365' }],
      ['/connect', { space: 'eve-owns-this-name' }],
    ]
    for (let [path, fields] of forged) {
      let r = await posted(k, path, fields, me.cookie, evil)
      assertEquals(r.status, 403, path)
      assertEquals((await r.json()).error.code, 'foreign_origin', path)
    }
    // The space is still there to be asked about.
    let still = await k.at('yaks.app', `/space/${me.name}/delete`, {
      headers: { cookie: me.cookie },
    })
    assertEquals(still.status, 200)
    await still.body?.cancel()
    // Consent does not rest on the Origin alone: a POST that did not come
    // from the page drawn for this person and this request is refused too.
    let bare = await posted(k, '/oauth/allow', { q }, me.cookie)
    assertEquals(bare.status, 403)
    await bare.body?.cancel()
    // And the person at the page itself allows as they always did.
    let mine = await allowed(k, q, me.cookie)
    assertEquals(mine.status, 302)
    await mine.body?.cancel()
  } finally {
    await k.stop()
  }
})
