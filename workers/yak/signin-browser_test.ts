import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { kernel, letters, mailed, unique } from './probe.ts'
import { browserOf } from './session.ts'
import { mac, mint, NETWORK_MISSES, SENDS, spend, TRIES } from './signin.ts'
import { held } from './signin-fixture.ts'

let a = crypto.randomUUID(), b = crypto.randomUUID()
let secret = 'browser-code-scope', address = 'browser@example.net'
let expires = new Date(Date.now() + 600_000).toISOString()
let scoped = (browser: string, code: string) => ({
  entity: { eid: crypto.randomUUID() },
  signin: { email: address, browser, code, expires, tries: 0 },
})
let digest = await mac(address, '123456', secret)
let tries = await held([scoped(a, digest), scoped(b, 'another-code')])
let crossing = await held([scoped(a, digest)])
let allowance = await held([])
for (let i = 0; i < SENDS; i++) {
  await mint(allowance.at, secret, address, '', { browser: a })
}

test('a browser’s wrong guesses spend only its own tries', async () => {
  for (let i = 0; i < TRIES; i++) {
    assertEquals(
      await spend(tries.at, secret, address, '654321', { browser: b }),
      null,
    )
  }
  assertEquals((await tries.rows(address)).map((r) => r.signin.tries), [
    0,
    TRIES,
  ])
  assert(await spend(tries.at, secret, address, '123456', { browser: a }))
})

test('an address’s wrong guesses count across browsers, and a browser new to them gets one', async () => {
  let [s1, s2, person] = [0, 1, 2].map(() => crypto.randomUUID())
  let at = await held([
    scoped(s1, 'x'),
    scoped(s2, 'y'),
    scoped(person, digest),
  ])
  let guess = (browser: string, code = '654321') =>
    spend(at.at, secret, address, code, { browser })
  for (let i = 0; i < TRIES; i++) assertEquals(await guess(s1), null)
  assertEquals(await guess(s2), null)
  assertEquals(await guess(s2), null)
  let tried = Object.fromEntries(
    (await at.rows(address)).map((r) => [r.signin.browser, r.signin.tries]),
  )
  assertEquals(tried, { [s1]: TRIES, [s2]: 1, [person]: 0 })
  assert(await guess(person, '123456'))
})

test('a network’s wrong guesses count across every address, and spend no other network’s', async () => {
  let stranger = crypto.randomUUID(), person = crypto.randomUUID()
  let sprayed = Array.from(
    { length: NETWORK_MISSES / 2 + 1 },
    (_, i) => `sprayed${i}@example.net`,
  )
  let at = await held([
    ...sprayed.map((to) => ({
      entity: { eid: crypto.randomUUID() },
      signin: { email: to, browser: stranger, code: 'x', expires, tries: 0 },
    })),
    scoped(person, digest),
  ])
  let guess = (to: string, from: string, browser = stranger, code = '654321') =>
    spend(at.at, secret, to, code, { browser, from })
  for (let i = 0; i < NETWORK_MISSES; i++) {
    assertEquals(await guess(sprayed[i >> 1], 'spray'), null)
  }
  // Spent: the next address is not compared at all.
  assertEquals(await guess(sprayed.at(-1)!, 'spray'), null)
  assertEquals(await at.tries(sprayed.at(-1)!), [0])
  // The person's own network still opens their code.
  assert(await guess(address, 'home', person, '123456'))
})

test('typed codes stay with their browser and emailed links open on another', async () => {
  assertEquals(
    await spend(crossing.at, secret, address, '123456', { browser: b }),
    null,
  )
  assertEquals((await crossing.rows(address))[0].signin.tries, 0)
  assert(
    await spend(crossing.at, secret, address, '123456', {
      via: 'link',
      browser: b,
    }),
  )
})

test('one browser exhausting its letters leaves another browser able to ask', async () => {
  assertEquals(
    await mint(allowance.at, secret, address, '', { browser: a }),
    null,
  )
  assert(await mint(allowance.at, secret, address, '', { browser: b }))
})

let k = await kernel(), email = `${unique('protected-inbox')}@example.net`
let post = (path: string, fields: Record<string, string>, cookie = '') =>
  k.at(k.host, path, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...cookie ? { cookie } : {},
    },
    body: new URLSearchParams(fields),
  })
let ask = async (cookie = '') => {
  let r = await post('/login', { address: email }, cookie)
  await r.body?.cancel()
  await k.deliveries()
  return r.headers.getSetCookie().find((c) => c.startsWith('yak_session='))
    ?.split(';')[0] ?? cookie
}
let victim = await ask(), code = await mailed(k, email)
let attacker = await ask()
for (let i = 1; i < SENDS; i++) await ask(attacker)
let right = letters(k, email).map((l) => /\b(\d{6})\b/.exec(l.subject)![1])
let wrong = Array.from(
  { length: right.length + 1 },
  (_, i) => String(i).padStart(6, '0'),
)
  .find((code) => !right.includes(code))!

test('a stranger cannot exhaust the victim’s asks or burn the victim’s mailed code', async () => {
  for (let i = 0; i < TRIES; i++) {
    let r = await post('/login/code', { address: email, code: wrong }, attacker)
    assertEquals(r.status, 400)
    await r.body?.cancel()
  }
  let before = letters(k, email).length
  await ask(victim)
  assertEquals(letters(k, email).length, before + 1)
  let r = await post('/login/code', { address: email, code }, victim)
  assertEquals(r.status, 303)
  await r.body?.cancel()
  assertEquals(
    (await browserOf(
      new Request(`https://${k.host}/`, { headers: { cookie: victim } }),
      k.secret,
    )) != null,
    true,
  )
})
