import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import {
  HOST_COOKIE,
  hostCookie,
  protectedCookie,
  sessionCookie,
  SHARED_UNTIL,
} from './browser-cookie.ts'
import { COOKIE, cookieValue, sign } from './lib/token.ts'
import { bindings } from './binding-probe.ts'
import { connector, kernel, signIn } from './probe.ts'

let request = (host: string, cookie: string) =>
  new Request(`https://${host}/login`, { headers: { cookie } })
let secret = 'host-cookie-test'
let env = bindings(secret, { APEX: 'yaks.app' }).env
let token = await sign({
  person: crypto.randomUUID(),
  space: null,
  exp: Math.floor(Date.now() / 1000) + 3600,
}, secret)

test('the apex prefers its host cookie; spaces read the shared cookie', () => {
  for (
    let cookie of [
      `${COOKIE}=planted; ${HOST_COOKIE}=mine; ${COOKIE}=shared`,
      `${HOST_COOKIE}=mine; ${COOKIE}=planted`,
    ]
  ) {
    assertEquals(sessionCookie(request('yaks.app', cookie)), 'mine')
    assertEquals(sessionCookie(request('space.yaks.app', cookie)), 'planted')
  }
  let req = request('yaks.app', `${COOKIE}=shared`)
  assertEquals(sessionCookie(req, {}, SHARED_UNTIL - 1), 'shared')
  assertEquals(sessionCookie(req, {}, SHARED_UNTIL), null)
  assertEquals(
    sessionCookie(request('yaks.app', `${HOST_COOKIE}=; ${COOKIE}=shared`)),
    '',
  )
})

test('an existing sign-in gains a protected cookie without changing its session', async () => {
  let req = request('yaks.app', `${COOKIE}=${token}`)
  let res = await protectedCookie(req, env, new Response('ok'))
  let set = res.headers.get('set-cookie')!
  assertStringIncludes(set, `${HOST_COOKIE}=${token}`)
  assertStringIncludes(set, 'Path=/;')
  assertStringIncludes(set, 'Secure; HttpOnly; SameSite=Lax')
  assertEquals(set.includes('Domain='), false)
  assertEquals(await res.text(), 'ok')
  let own = request('yaks.app', `${HOST_COOKIE}=${token}`)
  assertEquals(
    (await protectedCookie(own, env, new Response('ok'))).headers.get(
      'set-cookie',
    ),
    null,
  )
})

test('sign-in and sign-out set both cookies only on the apex', async () => {
  let set = `${COOKIE}=signed-out; Domain=yaks.app; Path=/; Secure; HttpOnly`
  let res = new Response(null, { headers: { 'set-cookie': set } })
  let at = await protectedCookie(request('yaks.app', ''), env, res)
  assertEquals(at.headers.getSetCookie(), [
    set,
    `${HOST_COOKIE}=signed-out; Path=/; Secure; HttpOnly`,
  ])
  let elsewhere = await protectedCookie(
    request('space.yaks.app', ''),
    env,
    new Response(null, { headers: { 'set-cookie': set } }),
  )
  assertEquals(elsewhere.headers.getSetCookie(), [set])
  assertEquals(hostCookie('x', 60).includes('Domain='), false)
})

let k = await kernel(), victim = await signIn(k), planted = await signIn(k)
let protectedValue = `${HOST_COOKIE}=${cookieValue(victim.cookie)}`
test('a planted shared cookie cannot change the account the connector and Profile see', async () => {
  let mixed = `${planted.cookie}; ${protectedValue}; ${victim.cookie}`
  let about = await connector(k, mixed).tool('about')
  assertStringIncludes(about, victim.email)
  assertEquals(about.includes(planted.email), false)
  let profile = await k.at(k.host, '/manage/account/profile', {
    headers: { cookie: mixed },
  })
  assertStringIncludes(await profile.text(), victim.email)
  let invalid = await k.at(k.host, '/login/who', {
    headers: { cookie: `${HOST_COOKIE}=junk; ${victim.cookie}` },
  })
  assertEquals((await invalid.json()).signedIn, false)
  let migration = await k.at(k.host, '/login/who', {
    headers: { cookie: victim.cookie },
  })
  assert((await migration.json()).signedIn)
  assert(
    migration.headers.getSetCookie().some((s) =>
      s.startsWith(`${HOST_COOKIE}=`)
    ),
  )
})
