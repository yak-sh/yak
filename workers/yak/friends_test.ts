import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { suggestion } from '@yaks/platform/friends'
import { noted } from '@yaks/notify/whereabouts'
import { connector, kernel, signIn } from './probe.ts'
import { managePath, talkPath } from '@yaks/platform/routes'

let k = await kernel()
let [ann, bo, cy, dee, eve, fay] = await Promise.all(
  [1, 2, 3, 4, 5, 6].map(() => signIn(k)),
)
let [annSpace, boSpace, cySpace, deeSpace, eveSpace] = await Promise.all(
  [ann, bo, cy, dee, eve].map((p) => k.dir.own(p.person)),
)
// Dee's one space is theirs, as a space born before `member.own` is.
let [deeSeat] = await k.dir.seats(dee.person, 'owner')
await k.dir.apply({
  entities: [{ entity: { eid: deeSeat.seat }, member: { own: null } }],
})
let tools = (p: typeof ann) => connector(k, p.cookie)
let listed = async (p: typeof ann) =>
  Object.fromEntries(
    ((await tools(p).answer('friend_list', {})).value?.friends as {
      person: string
      standing: string
    }[]).map((f) => [f.person, f.standing]),
  )
let updates = (p: typeof ann, slug: string) =>
  k.at(k.host, `/${slug}/updates`, { headers: { cookie: p.cookie } })
let answer = (p: typeof ann, slug: string, friend: string, verdict: string) =>
  k.at(k.host, `/${slug}/updates`, {
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
  let fallback = await (await updates(bo, boSpace.slug)).text()
  assertStringIncludes(fallback, `${cy.name} is on yaks.app too`)
  let saved = await k.at(k.host, managePath('profile'), {
    method: 'POST',
    headers: {
      cookie: bo.cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ name: 'Bea Alvarez' }).toString(),
  })
  assertEquals(saved.status, 303, await saved.text())
  let page = await (await updates(cy, cySpace.slug)).text()
  assertStringIncludes(page, 'Someone you know?')
  assertStringIncludes(page, 'Bea Alvarez is on yaks.app too')
  let all = await k.at(k.host, talkPath('updates'), {
    headers: { cookie: cy.cookie },
  })
  assertStringIncludes(await all.text(), 'Bea Alvarez is on yaks.app too')
  await answer(cy, cySpace.slug, bo.person, 'approved')
  assertEquals((await listed(cy))[bo.person], 'asking')
  assertEquals((await listed(bo))[cy.person], 'asked')
  await answer(bo, boSpace.slug, cy.person, 'declined')
  assertEquals((await listed(bo))[cy.person], undefined)
})

test('a request reaches a person whose own space was never marked', async () => {
  await tools(ann).answer('friend_add', { email: dee.email })
  let page = await (await updates(dee, deeSpace.slug)).text()
  assertStringIncludes(page, 'Friend request')
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

// Eve and Fay are friends; Eve and Ann are not.
await connector(k, eve.cookie).answer('friend_add', { email: fay.email })
await connector(k, fay.cookie).answer('friend_add', { email: eve.email })
await connector(k, eve.cookie).tool('app_new', {
  space: eveSpace.slug,
  slug: 'gift',
  title: 'Gift',
})

test('an owner invites a friend by picking them, never typing their email', async () => {
  let page = await (await k.at(k.host, `/manage/${eveSpace.slug}/people`, {
    headers: { cookie: eve.cookie },
  })).text()
  assertStringIncludes(page, `value="${fay.person}"`)
  let sent = await k.at(k.host, `/manage/${eveSpace.slug}/people`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: eve.cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ friend: fay.person, invite: '', app: 'gift' })
      .toString(),
  })
  assertEquals(sent.status, 303, await sent.text())
  assertEquals(
    !!await k.dir.invite((await k.dir.app(eveSpace, 'gift'))!.eid, fay.person),
    true,
  )
})

test('an app is offered to a friend by picking them', async () => {
  let offered = await connector(k, eve.cookie).answer('app_transfer', {
    space: eveSpace.slug,
    app: 'gift',
    friend: fay.person,
  })
  assertStringIncludes(offered.text, fay.email)
})

test('only a confirmed friend can be picked', async () => {
  await assertRejects(
    () =>
      connector(k, eve.cookie).tool('member_add', {
        space: eveSpace.slug,
        friend: ann.person,
      }),
    Error,
    'friend list',
  )
})

// Fay has her Operator open in her own space, Eve's public Gift app, and a
// private app of her own.
let faySpace = await k.dir.own(fay.person)
await connector(k, fay.cookie).tool('app_new', {
  space: faySpace.slug,
  slug: 'secret',
  title: 'Secret',
  access: 'private',
})
let [gift, secret] = await Promise.all([
  k.dir.app(eveSpace, 'gift'),
  k.dir.app(faySpace, 'secret'),
])
await k.dir.apply({
  entities: [
    noted(undefined, {
      person: fay.person,
      channel: 'operator',
      place: faySpace.eid,
      state: 'here',
    }),
    ...[gift!, secret!].map((app) =>
      noted(undefined, {
        person: fay.person,
        channel: 'apps',
        place: app.eid,
        state: 'open',
      })
    ),
  ].map((b) => b!),
})

test('a friend building shows only the apps and spaces you can already open', async () => {
  let fays = ((await tools(eve).answer('friend_list', {})).value?.friends as {
    person: string
    presence?: { state: string; spaces: unknown[]; apps: { slug: string }[] }
  }[]).find((f) => f.person == fay.person)
  assertEquals(fays?.presence?.state, 'building')
  assertEquals(fays?.presence?.spaces, [])
  assertEquals(fays?.presence?.apps.map((a) => a.slug), ['gift'])
  let page = await (await updates(eve, eveSpace.slug)).text()
  assertStringIncludes(page, 'Friends on yaks.app now')
  assertEquals(page.includes('Secret'), false)
})

test('nobody but a friend sees where someone is', async () => {
  let page = await (await updates(ann, annSpace.slug)).text()
  assertEquals(page.includes('Friends on yaks.app now'), false)
})

test('a friend’s message lands in their Updates, and a reply there comes back', async () => {
  await tools(eve).answer('friend_message', {
    friend: fay.person,
    words: 'Can you help me with Gift?',
  })
  let page = await (await updates(fay, faySpace.slug)).text()
  assertStringIncludes(page, 'Can you help me with Gift?')
  let mine = (await tools(fay).answer('friend_messages', {})).value
    ?.messages as { outgoing: boolean; read: boolean; friend: string }[]
  assertEquals(mine[0].friend, eve.person)
  assertEquals(mine[0].read, true)
  let replied = await k.at(k.host, `/${faySpace.slug}/updates`, {
    method: 'POST',
    headers: {
      cookie: fay.cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ message: eve.person, say: 'On my way' })
      .toString(),
  })
  assertEquals(replied.status, 303, await replied.text())
  let theirs = (await tools(eve).answer('friend_messages', {})).value
    ?.messages as { outgoing: boolean; words: string }[]
  assertEquals(theirs[0], { ...theirs[0], outgoing: false, words: 'On my way' })
})

test('only a confirmed friend can be messaged', async () => {
  await assertRejects(
    () =>
      tools(eve).tool('friend_message', { friend: ann.person, words: 'Hi' }),
    Error,
    'friend list',
  )
})

test('a person who hides their presence shows to no friend, until they show it again', async () => {
  let seen = async () =>
    ((await tools(eve).answer('friend_list', {})).value?.friends as {
      person: string
      presence?: unknown
    }[]).find((f) => f.person == fay.person)?.presence
  await tools(fay).answer('friend_presence', { hidden: true })
  assertEquals(await seen(), undefined)
  let page = await (await updates(eve, eveSpace.slug)).text()
  assertEquals(page.includes('Friends on yaks.app now'), false)
  let shown = await k.at(k.host, managePath('profile'), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: fay.cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ presence: 'shown' }).toString(),
  })
  assertEquals(shown.status, 303, await shown.text())
  assertEquals((await seen() as { state: string }).state, 'building')
})
