import { assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { connector, kernel, signIn } from './probe.ts'
import { cookieValue, verify } from './lib/token.ts'

let k = await kernel(), owner = await signIn(k), visitor = await signIn(k)
let post = (
  path: string,
  cookie: string,
  fields: Record<string, string>,
  origin = 'https://yaks.app',
) =>
  k.at(k.host, path, {
    method: 'POST',
    headers: {
      cookie,
      origin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
  })
let minted = await post('/login/link', owner.cookie, {})
let link = new URL((await minted.json()).url)
let path = link.pathname + link.search, t = link.searchParams.get('t')!
let started = await post('/start', '', { say: 'A private prayer list' })
let guest =
  started.headers.getSetCookie().find((s) => s.startsWith('yak_session='))!
    .split(';')[0]
let person = (await verify(cookieValue(guest)!, k.secret))!.person
let seats = (await k.dir.seats(person)).map((s) => s.space.eid)
let phonePerson = crypto.randomUUID()
await k.dir.stamp({
  entities: [{
    entity: { eid: phonePerson },
    person: {},
    phone: { number: '+12025550123' },
  }],
})
let phoneCookie = `yak_session=${await (await import('./lib/token.ts')).sign({
  person: phonePerson,
  space: null,
  exp: Math.floor(Date.now() / 1000) + 3600,
}, k.secret)}`
let phoneLink = new URL(
  (await (await post('/login/link', phoneCookie, {})).json()).url,
)

test('a standing-link confirmation identifies a person whose sign-in is a phone number', async () => {
  let r = await k.at(k.host, phoneLink.pathname + phoneLink.search)
  assertEquals(r.status, 200)
  assertStringIncludes(await r.text(), '+12025550123')
})

test('standing-link GETs show the account, and a cross-origin POST cannot sign in', async () => {
  let card = await k.at(k.host, path, {
    headers: {
      cookie: visitor.cookie,
      origin: 'https://elsewhere.yaks.app',
      'sec-fetch-dest': 'image',
    },
  })
  assertEquals(card.status, 200)
  assertStringIncludes(await card.text(), owner.email)
  assertEquals(
    card.headers.getSetCookie().some((s) => s.startsWith('yak_session=')),
    false,
  )
  assertStringIncludes(
    await connector(k, visitor.cookie).tool('about'),
    visitor.email,
  )
  let refused = await post(
    '/login/link',
    visitor.cookie,
    { t },
    'https://elsewhere.yaks.app',
  )
  assertEquals(refused.status, 403)
})

test('a standing-link confirmation signs in without handing over the newcomer space', async () => {
  let card = await k.at(k.host, path, { headers: { cookie: guest } })
  assertEquals(card.status, 200)
  await card.body?.cancel()
  assertEquals((await k.dir.seats(person)).map((s) => s.space.eid), seats)
  let res = await post('/login/link', guest, { t })
  assertEquals(res.status, 303)
  let cookie = res.headers.getSetCookie().find((s) =>
    s.startsWith('yak_session=')
  )!
  assertEquals(
    (await verify(cookieValue(cookie)!, k.secret))?.person,
    owner.person,
  )
  assertEquals((await k.dir.seats(person)).map((s) => s.space.eid), seats)
  assertEquals(
    (await k.dir.seats(owner.person)).some((s) => seats.includes(s.space.eid)),
    false,
  )
})
