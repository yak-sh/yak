import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { test } from '@yaks/testing'
import { kernel, signIn } from './probe.ts'
import { managePath } from '@yaks/platform/routes'

let k = await kernel()
let one = await signIn(k), two = await signIn(k, one.email)
let three = await signIn(k, one.email), other = await signIn(k)
let profile = managePath('profile')
let post = (path: string, cookie: string, fields = {}) =>
  k.at(k.host, path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  })
let signed = async (cookie: string) =>
  (await (await k.at(k.host, '/login/who', { headers: { cookie } })).json())
    .signedIn

test('logout and Profile end selected browsers through the HTTP doors', async () => {
  let logout = await post('/logout', one.cookie)
  assertEquals(logout.status, 303)
  assertEquals(await signed(one.cookie), false)
  assertEquals(await signed(two.cookie), true)

  let page = await k.at(k.host, profile, { headers: { cookie: two.cookie } })
  let { document } = parseHTML(await page.text())
  assert(document.body.textContent.includes('Signed-in browsers'))
  let sessions = await k.dir.browserSessions(one.person)
  assertEquals(sessions.length, 2)
  let foreign = (await k.dir.browserSessions(other.person))[0]
  assertEquals(
    (await post(profile, two.cookie, { session: foreign.eid })).status,
    303,
  )
  assertEquals(await signed(other.cookie), true)
  let third = sessions.find((s) => s.eid != sessions[0].eid)!
  // The browser chooses a row from the rendered list, regardless of its order.
  assert(document.querySelector(`input[name="session"][value="${third.eid}"]`))
  let current = sessions[0]
  await post(profile, two.cookie, { session: third.eid })
  let live = [await signed(two.cookie), await signed(three.cookie)]
  assertEquals(live.filter(Boolean).length, 1)
  let survivor = live[0] ? two.cookie : three.cookie
  assertEquals((await k.dir.browserSessions(one.person))[0].eid, current.eid)
  await post(profile, survivor, { session: 'all' })
  assertEquals(await signed(two.cookie), false)
  assertEquals(await signed(three.cookie), false)
  assertEquals(await signed(other.cookie), true)
})
