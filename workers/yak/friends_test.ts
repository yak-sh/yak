import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { suggestion } from '@yaks/platform/friends'
import { connector, kernel, signIn } from './probe.ts'

let k = await kernel()
let [ann, bo, cy] = await Promise.all([signIn(k), signIn(k), signIn(k)])
let [annSpace, boSpace, cySpace] = await Promise.all(
  [ann, bo, cy].map((p) => k.dir.own(p.person)),
)
let tools = (p: typeof ann) => connector(k, p.cookie)
let listed = async (p: typeof ann) =>
  Object.fromEntries(
    ((await tools(p).answer('friend_list', {})).value?.friends as {
      person: string
      standing: string
    }[]).map((f) => [f.person, f.standing]),
  )
let updates = (p: typeof ann, slug: string) =>
  k.at(k.host, `/manage/${slug}/updates`, { headers: { cookie: p.cookie } })
let answer = (p: typeof ann, slug: string, friend: string, verdict: string) =>
  k.at(k.host, `/manage/${slug}/updates`, {
    method: 'POST',
    headers: {
      cookie: p.cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ friend, answer: verdict }).toString(),
  })

test('two people are friends once each says yes, and the second says it in Updates', async () => {
  let asked = await tools(ann).answer('friend_add', { email: bo.email })
  assertStringIncludes(asked.text, 'friend request')
  assertEquals((await listed(ann))[bo.person], 'asking')
  assertEquals((await listed(bo))[ann.person], 'asked')
  let page = await (await updates(bo, boSpace.slug)).text()
  assertStringIncludes(page, 'Friend request')
  assertStringIncludes(page, 'Add friend')
  let yes = await answer(bo, boSpace.slug, ann.person, 'approved')
  assertEquals(yes.status, 303, await yes.text())
  assertEquals((await listed(ann))[bo.person], 'friend')
  assertEquals((await listed(bo))[ann.person], 'friend')
  assertEquals(
    (await (await updates(bo, boSpace.slug)).text()).includes('Friend request'),
    false,
  )
})

test('unfriending ends it for both, and the other is asked nothing', async () => {
  await tools(cy).answer('friend_add', { email: ann.email })
  await tools(ann).answer('friend_add', { person: cy.person })
  assertEquals((await listed(cy))[ann.person], 'friend')
  await tools(ann).answer('friend_remove', { person: cy.person })
  assertEquals((await listed(ann))[cy.person], undefined)
  assertEquals((await listed(cy))[ann.person], 'asking')
})

test('a suggestion friends nobody until each says yes, and becomes a request', async () => {
  await k.dir.stamp({ entities: suggestion(bo.person, cy.person) })
  assertEquals((await listed(bo))[cy.person], 'suggested')
  assertEquals((await listed(cy))[bo.person], 'suggested')
  let page = await (await updates(cy, cySpace.slug)).text()
  assertStringIncludes(page, 'Someone you know?')
  await answer(cy, cySpace.slug, bo.person, 'approved')
  assertEquals((await listed(cy))[bo.person], 'asking')
  assertEquals((await listed(bo))[cy.person], 'asked')
  await answer(bo, boSpace.slug, cy.person, 'declined')
  assertEquals((await listed(bo))[cy.person], undefined)
})

test('nobody friends themselves or a person who is not on yaks.app', async () => {
  await assertRejects(() =>
    tools(ann).tool('friend_add', { person: ann.person })
  )
  await assertRejects(() =>
    tools(ann).tool('friend_add', { person: annSpace.eid })
  )
  await assertRejects(() =>
    tools(ann).tool('friend_add', { email: `nobody@${k.host}` })
  )
})
