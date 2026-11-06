// What an ad network is told of a visit its click brought (conversions.ts),
// through the kernel's own doors: a page of the site, then a sign-up.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { kernel, mailed, toldMeta, unique } from './probe.ts'
import { COOKIE } from './arrival.ts'

let BROWSER = 'Mozilla/5.0 (Macintosh) AppleWebKit Safari'

type Event = {
  event_name: string
  event_source_url: string
  user_data: Record<string, string>
}

test('a visit an ad brought is told as a page seen, and its sign-up as a registration', async () => {
  let k = await kernel()
  let before = toldMeta(k).length
  let told = async () => {
    await k.settled()
    return toldMeta(k).slice(before) as { token: string; event: Event }[]
  }
  let ip = '203.0.113.9'
  let page = await k.at(k.host, '/?fbclid=Ab1&utm_source=meta', {
    headers: { 'user-agent': BROWSER, 'cf-connecting-ip': ip },
  })
  assertEquals(page.status, 200)
  await page.body?.cancel()
  let came = page.headers.get('set-cookie')!
  assertStringIncludes(came, `${COOKIE}=`)
  assertStringIncludes(came, 'HttpOnly')
  let [{ token, event }] = await told()
  assertEquals(token, 'a-token')
  assertEquals(event.event_name, 'PageView')
  assertEquals(event.event_source_url, `https://${k.host}/`)
  assertEquals(event.user_data.client_ip_address, ip)
  assertEquals(event.user_data.client_user_agent, BROWSER)
  assert(/^fb\.1\.\d+\.Ab1$/.test(event.user_data.fbc), event.user_data.fbc)

  // The same browser signs up with its arrival in hand.
  let email = `${unique('ad')}@${k.host}`
  let form = (path: string, fields: Record<string, string>) =>
    k.at(k.host, path, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': BROWSER,
        cookie: came.split(';')[0],
      },
      body: new URLSearchParams(fields).toString(),
    })
  await (await form('/login', { address: email })).body?.cancel()
  let inn = await form('/login/code', {
    address: email,
    code: await mailed(k, email),
  })
  assertEquals(inn.status, 303)
  await inn.body?.cancel()
  let signup = (await told()).at(-1)!.event
  assertEquals(signup.event_name, 'CompleteRegistration')
  assertEquals(signup.user_data.fbc, event.user_data.fbc)
  assertEquals(JSON.stringify(signup).includes(email), false)

  // A visit no ad sent tells nobody, and keeps no arrival.
  let plain = await k.at(k.host, '/', { headers: { 'user-agent': BROWSER } })
  await plain.body?.cancel()
  assertEquals(plain.headers.get('set-cookie'), null)
  assertEquals((await told()).length, 2)
})
