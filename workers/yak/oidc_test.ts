// "Continue with Google" end to end, in process: the sign-in card's button,
// the trip to Google's authorize endpoint, and the return, whose code Google's
// token endpoint (stood in for at SIGNIN_FETCH) answers with an id_token.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { line } from '@yaks/query'
import { test } from '@yaks/testing'
import { registration } from '@yaks/connections'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import { platform } from './testing.ts'
import { KERNEL, meta } from './meta.ts'
import { COOKIE, cookieValue, verify } from './lib/token.ts'
import * as identity from './identity.ts'
import { NOT_FINISHED, PROVIDERS, UNVERIFIED } from './oidc.ts'

let KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
let SECRET = 'an oidc probe secret'
let CLIENT = 'yaks-signin.apps.googleusercontent.com'
let google = PROVIDERS.google

let jwt = (claims: object) =>
  `e30.${btoa(JSON.stringify(claims)).replaceAll('=', '')}.sig`

// What Google's id_token says, for an address: verified, for our client.
let said = (email: string, more: object = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT,
  sub: email,
  exp: Math.floor(Date.now() / 1000) + 3600,
  email,
  email_verified: true,
  ...more,
})

let setup = async (kept = true) => {
  // Each code Google hands back, and the claims its exchange answers with.
  let codes = new Map<string, object>()
  let exchanged: URLSearchParams[] = []
  let p = platform(SECRET, {
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: KEY,
    SIGNIN_FETCH: (input, init) => {
      assertEquals(String(input), google.token)
      let form = new URLSearchParams(String(init?.body))
      exchanged.push(form)
      let claims = codes.get(form.get('code')!)
      return Promise.resolve(
        claims
          ? Response.json({ access_token: 'at', id_token: jwt(claims) })
          : Response.json({ error: 'invalid_grant' }, { status: 400 }),
      )
    },
  })
  if (kept) {
    await meta(p.env).apply(
      [registration(google.client, { id: CLIENT, secret: 'shh' })],
      KERNEL,
    )
  }
  let at = (path: string, init: RequestInit = {}) =>
    identity.fetch(new Request(`https://yaks.app${path}`, init), p.env)
  let jar = (r: Response) =>
    r.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) =>
      !c.endsWith('=')
    ).join('; ')
  // Press the button, and come back from Google with a code whose exchange
  // answers `claims`, or with what `back` puts on the return instead.
  let signIn = async (
    claims: object | null,
    back: (state: string) => string = (state) => `code=C&state=${state}`,
  ) => {
    let went = await at('/login/google', {
      method: 'POST',
      body: new URLSearchParams({ return: '' }),
    })
    assertEquals(went.status, 303)
    let to = new URL(went.headers.get('location')!)
    if (claims) codes.set('C', claims)
    let r = await at(
      `/login/google/callback?${back(to.searchParams.get('state')!)}`,
      { headers: { cookie: jar(went) } },
    )
    codes.clear()
    return { to, r }
  }
  let people = (email: string) =>
    meta(p.env).query(line`.person&.email.address=${email}&?signed_in`)
  let whoIs = async (r: Response) =>
    (await verify(cookieValue(jar(r), COOKIE) ?? '', SECRET))?.person
  return { at, signIn, people, whoIs, exchanged }
}

test('the sign-in card offers Google once its client is kept, and only then', async () => {
  let card = async (kept: boolean) =>
    await (await (await setup(kept)).at('/login')).text()
  let [offered, not] = await Promise.all([card(true), card(false)])
  assertStringIncludes(offered, 'action="/login/google"')
  assertStringIncludes(offered, 'Continue with Google')
  assert(!not.includes('/login/google'))
})

test('the button sends the browser to Google for openid, email and profile alone', async () => {
  let { to } = await (await setup()).signIn(null)
  assertEquals(to.origin + to.pathname, google.authorize)
  assertEquals(
    Object.fromEntries(
      ['client_id', 'redirect_uri', 'scope', 'response_type', 'prompt'].map((
        k,
      ) => [k, to.searchParams.get(k)]),
    ),
    {
      client_id: CLIENT,
      redirect_uri: 'https://yaks.app/login/google/callback',
      scope: 'openid email profile',
      response_type: 'code',
      prompt: 'select_account',
    },
  )
  assertEquals(to.searchParams.get('code_challenge_method'), 'S256')
})

test('a new verified address is somebody new, signed in on their own space', async () => {
  let s = await setup()
  let email = 'new.person@gmail.com'
  let { r } = await s.signIn(said('New.Person@gmail.com'))
  assertEquals(r.status, 303)
  let [person] = await s.people(email)
  assertEquals(await s.whoIs(r), person.entity.eid)
  assertEquals((person.signed_in as { via: string }).via, 'google')
  assert((person.signed_in as { first?: string }).first)
  // Their own space's chat, made for them in the write that signed them in.
  assertEquals(r.headers.get('location'), 'https://yaks.app/manage/new-person')
  assertEquals(r.headers.get('referrer-policy'), 'no-referrer')
  // The exchange spent the code with the verifier and our client's secret.
  let [form] = s.exchanged
  assertEquals(form.get('grant_type'), 'authorization_code')
  assert(form.get('code_verifier'))
})

test('an address that already has a person signs in as them, never a second', async () => {
  let s = await setup()
  let email = 'ada@example.com'
  let first = await s.signIn(said(email))
  let again = await s.signIn(said(email))
  let held = await s.people(email)
  assertEquals(held.length, 1)
  assertEquals(await s.whoIs(again.r), held[0].entity.eid)
  assertEquals(await s.whoIs(first.r), held[0].entity.eid)
})

test('a return that proves nothing signs nobody in and says so', async () => {
  let s = await setup()
  let refused = async (
    claims: object | null,
    why: string,
    back?: (state: string) => string,
  ) => {
    let { r } = await s.signIn(claims, back)
    assertEquals(r.status, 400)
    assertStringIncludes(
      (await r.text()).replaceAll('&#39;', "'"),
      why.split('.')[0],
    )
    assertEquals(await s.whoIs(r), undefined)
  }
  let email = 'eve@example.com'
  await refused(said(email, { email_verified: false }), UNVERIFIED('Google'))
  await refused(said(email, { aud: 'another' }), NOT_FINISHED('Google'))
  await refused(
    said(email, { iss: 'https://evil.test' }),
    NOT_FINISHED('Google'),
  )
  await refused(
    said(email),
    NOT_FINISHED('Google'),
    () => 'code=C&state=forged',
  )
  await refused(
    null,
    NOT_FINISHED('Google'),
    (state) => `error=access_denied&state=${state}`,
  )
  assertEquals(await s.people(email), [])
})

test('a deploy with no Google client answers the button with the card', async () => {
  let s = await setup(false)
  let r = await s.at('/login/google', { method: 'POST' })
  assertEquals(r.status, 503)
  await r.body?.cancel()
})
