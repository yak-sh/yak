// Sign-in and identity, attacked, held in workerd (T-37872). Each test is one
// hole the 2026-09-22 audit proved on a local kernel, fired again at the
// kernel exactly as it was fired then, beside the traffic that must keep
// working. The root that made most of them reachable is the platform's shape:
// yaks.app is not on the Public Suffix List, so every `<space>.yaks.app` app is
// same-site with the apex, and anybody can serve code from a free space.
import { assertEquals } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { COOKIE } from '../../src/token.ts'
import { allowed, type Kernel, kernel, signIn } from './probe.ts'
import { granting } from './dispatch.ts'
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
