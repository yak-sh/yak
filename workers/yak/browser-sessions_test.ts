import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { test } from '@yaks/testing'
import { kernel, reach, signIn, wrote } from './probe.ts'
import { SIGNED_IN, signedInOf } from '@yaks/platform/account-rows'
import { managePath } from '@yaks/platform/routes'
import { headings } from '@yaks/ui/contents'

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

test('Profile lists its cards in its contents and names this browser first', async () => {
  let page = await k.at(k.host, profile, { headers: { cookie: other.cookie } })
  let { document } = parseHTML(await page.text())
  let nav = document.querySelector('.Contents') as HTMLElement
  let root = nav.closest('[data-contents-root]')!
  assertEquals(
    headings(root, nav.dataset.contents!).map((e) => e.label),
    ['Profile', 'Signed-in browsers'],
  )
  let rows = [...document.querySelectorAll('.Rows_Item')]
  assertEquals(rows.length, 1)
  assertEquals(rows[0].querySelector('.Rows_Name')!.textContent, 'Browser')
  assert(
    rows[0].querySelector('.Rows_Meta')!.textContent.includes('this browser'),
  )
})

// Profile signing a browser out, as its page writes it through the page graph.
let signOut = (cookie: string, session: string) =>
  wrote(k, { person: one.person, cookie }, [{
    entity: { eid: crypto.randomUUID() },
    signOut: { session },
  }])

test('logout and Profile end selected browsers through their doors', async () => {
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
  assertEquals((await signOut(two.cookie, foreign.eid)).status, 200)
  assertEquals(await signed(other.cookie), true)
  let third = sessions.find((s) => s.eid != sessions[0].eid)!
  // The browser chooses a row from the rendered list, regardless of its order.
  assert(document.querySelector(`[data-sign-out="${third.eid}"]`))
  let current = sessions[0]
  await signOut(two.cookie, third.eid)
  let live = [await signed(two.cookie), await signed(three.cookie)]
  assertEquals(live.filter(Boolean).length, 1)
  let survivor = live[0] ? two.cookie : three.cookie
  assertEquals((await k.dir.browserSessions(one.person))[0].eid, current.eid)
  let held = await (await reach(
    k,
    { person: one.person, cookie: survivor },
    `/query?q=${SIGNED_IN}`,
  )).json()
  assertEquals(signedInOf(held).map((b) => b.eid), [current.eid])
  await signOut(survivor, 'all')
  assertEquals(await signed(two.cookie), false)
  assertEquals(await signed(three.cookie), false)
  assertEquals(await signed(other.cookie), true)
})
