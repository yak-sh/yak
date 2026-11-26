import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { suggestion } from '@yaks/platform/friends'
import {
  FRIEND_MESSAGES,
  FRIENDS,
  friendsOf,
  messagesOf,
} from '@yaks/platform/account-rows'
import { noted } from '@yaks/notify/whereabouts'
import { connector, kernel, pressPeople, saveAccount, signIn } from './probe.ts'
import { managePath, talkPath } from '@yaks/platform/routes'
import { REACH, TAB_PERSON } from '@yaks/platform/page-graph'
import { APP_FRIEND, APP_FRIENDS } from '@yaks/platform/app-friends'
import { DAY, type Day } from '@yaks/platform/updates-day'

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
  let saved = await saveAccount(k, bo, { name: 'Bea Alvarez' })
  assertEquals(saved.status, 200, await saved.text())
  let page = await (await updates(cy, cySpace.slug)).text()
  assertStringIncludes(page, 'Someone you know?')
  assertStringIncludes(page, 'Bea Alvarez is on yaks.app too')
  let all = await k.at(k.host, talkPath('updates'), {
    headers: { cookie: cy.cookie },
  })
  assertStringIncludes(await all.text(), 'Bea Alvarez is on yaks.app too')
  let entity = { eid: crypto.randomUUID() }
  let apply = (p: typeof cy) =>
    k.at(k.host, `${REACH}/apply`, {
      method: 'POST',
      headers: {
        cookie: p.cookie,
        'content-type': 'application/json',
        [TAB_PERSON]: p.person,
      },
      body: JSON.stringify([{
        entity,
        inboxAction: {
          space: cySpace.eid,
          kind: 'friend',
          target: bo.person,
          answer: 'approved',
        },
      }]),
    })
  assertEquals((await apply(bo)).status, 403)
  let accepted = await apply(cy)
  assertEquals(accepted.status, 200)
  assertEquals(accepted.headers.get('location'), null)
  assertEquals(await accepted.json(), [{
    entity,
    inboxReceipt: { label: 'Request sent' },
  }])
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
  let sent = await pressPeople(k, eve, eveSpace.slug, 'memberAdd', {
    friend: fay.person,
    app: 'gift',
  })
  assertEquals(sent, { status: 200, said: 'Invitation sent.' })
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
  let seen = await friendInUpdates(eve, eveSpace, fay.person)
  assertEquals(seen?.state, 'building')
  assertEquals(seen?.spaces, [])
  assertEquals(seen?.apps.map((a) => a.slug), ['gift'])
})

test('nobody but a friend sees where someone is', async () => {
  assertEquals(await friendInUpdates(ann, annSpace, fay.person), undefined)
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
  assertEquals(await friendInUpdates(eve, eveSpace, fay.person), undefined)
  let shown = await saveAccount(k, fay, { hidden: false })
  assertEquals(shown.status, 200, await shown.text())
  assertEquals((await seen() as { state: string }).state, 'building')
  assertEquals(
    (await friendInUpdates(eve, eveSpace, fay.person))?.state,
    'building',
  )
})

let friendsPage = async (p: typeof ann, query = '') =>
  await (await k.at(k.host, managePath('friends') + query, {
    headers: { cookie: p.cookie },
  })).text()
// The friends and messages as the page graph reads them through its door.
let door = (p: typeof ann, path: string, init: RequestInit = {}) =>
  k.at(k.host, `${REACH}${path}`, {
    ...init,
    headers: {
      cookie: p.cookie,
      [TAB_PERSON]: p.person,
      'content-type': 'application/json',
    },
  })
let friendInUpdates = async (
  p: typeof ann,
  space: typeof annSpace,
  friend: string,
) => {
  let { document } = parseHTML(await (await updates(p, space.slug)).text())
  let day = document.querySelector(`[${DAY}]`)?.getAttribute(DAY)
  assertEquals(day && JSON.parse(day) as Day, {
    person: p.person,
    space: space.eid,
    friends: true,
  })
  let response = await door(p, `/query?q=${FRIENDS}`)
  assertEquals(response.status, 200)
  return friendsOf(await response.json()).find((f) => f.person == friend)?.seen
}
let live = async (p: typeof ann) => {
  let rows = await (await door(p, `/query?q=${FRIENDS}`)).json()
  return Object.fromEntries(
    friendsOf(rows).map((f) => [
      f.person,
      f.seen ? { state: f.seen.state, last: f.seen.last } : {},
    ]),
  )
}
let message = (
  from: typeof ann,
  to: typeof ann,
  words: string,
  eid: string = crypto.randomUUID(),
) =>
  door(from, '/apply', {
    method: 'POST',
    body: JSON.stringify([{
      entity: { eid },
      friendMessage: { to: to.person, words },
    }]),
  })
let said = async (p: typeof ann) =>
  messagesOf(await (await door(p, `/query?q=${FRIEND_MESSAGES}`)).json())

test('a friend’s row holds the apps they let you into, and every page holds friends over it', async () => {
  let page = await friendsPage(eve)
  assertStringIncludes(page, 'data-friends-dock=')
  assertStringIncludes(page, '_dock.js')
  assertStringIncludes(page, 'Show when I’m online')
  await k.dir.apply({
    entities: [{
      entity: { eid: crypto.randomUUID() },
      grant: { app: gift!.eid, person: fay.person, access: 'editor' },
    }],
  })
  let rows = friendsOf(await (await door(fay, `/query?q=${FRIENDS}`)).json())
  assertEquals(rows.map((f) => f.person), [eve.person])
  assertEquals(rows[0].shared.map((a) => a.title), ['Gift'])
  let talk = await (await k.at(k.host, `/${faySpace.slug}`, {
    headers: { cookie: fay.cookie },
  })).text()
  assertStringIncludes(talk, 'data-friends-dock=')
  assertStringIncludes(talk, 'data-dock-bar')
})

test('someone who hides their status is seen by no friend and sees none', async () => {
  let hid = await saveAccount(k, fay, { hidden: true })
  assertEquals(hid.status, 200, await hid.text())
  assertEquals((await live(eve))[fay.person], {})
  assertEquals((await live(fay))[eve.person], {})
  await saveAccount(k, fay, { hidden: false })
  assertEquals((await live(eve))[fay.person].state, 'building')
})

test('a message is the row its page named, to both friends, read once its reader opens it', async () => {
  let eid = crypto.randomUUID()
  let sent = await message(eve, fay, 'Lunch?', eid)
  assertEquals(sent.status, 200, await sent.text())
  assertEquals((await message(eve, fay, 'Lunch?', eid)).status, 200)
  let mine = (await said(eve)).filter((m) => m.eid == eid)
  let theirs = (await said(fay)).filter((m) => m.eid == eid)
  assertEquals(mine.map((m) => [m.from, m.to, m.words]), [
    [eve.person, fay.person, 'Lunch?'],
  ])
  assertEquals(theirs.map((m) => m.read), [false])
  assertStringIncludes(
    await (await updates(fay, faySpace.slug)).text(),
    'Lunch?',
  )
  let read = await door(fay, '/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid }, friendMessage: { read: true } }]),
  })
  assertEquals(read.status, 200, await read.text())
  assertEquals(
    (await said(fay)).find((m) => m.eid == eid)?.read,
    true,
  )
})

test('a message to someone not a friend, or named as another thing, is refused', async () => {
  let refused = await message(eve, ann, 'Hi')
  assertEquals(refused.status, 400)
  assertStringIncludes(await refused.text(), 'friend list')
  let taken = await message(eve, fay, 'Hi', gift!.eid)
  assertEquals(taken.status, 400)
  assertStringIncludes(await taken.text(), 'of its own')
})

test('app friends require the player’s consent and a play invite reaches both friend surfaces', async () => {
  let host = `${eveSpace.slug}.${k.host}`
  let api = (path: string, p = eve, init: RequestInit = {}) =>
    k.at(host, `/gift/api${path}`, {
      ...init,
      headers: { cookie: p.cookie, 'content-type': 'application/json' },
    })
  let read = async (q: string, p = eve) => {
    let res = await api(`/query?q=${q}`, p)
    assertEquals(res.status, 200)
    return await res.json()
  }
  let change = (act: 'source-grant' | 'source-revoke') =>
    k.at(k.host, `/manage/${eveSpace.slug}/connections`, {
      method: 'POST',
      headers: {
        cookie: eve.cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ do: act, app: gift!.eid, at: 'friends' })
        .toString(),
    })
  let eid = crypto.randomUUID()
  let invite = (to: string, path = 'play#expedition', check = '') =>
    api('/apply' + check, eve, {
      method: 'POST',
      body: JSON.stringify({
        entities: [{ entity: { eid }, friend_invite: { to, path } }],
      }),
    })
  assertEquals((await read(APP_FRIENDS))[0].app_friends, {
    signed_in: true,
    allowed: false,
  })
  assertEquals(await read(APP_FRIEND), [])
  assertEquals((await invite(fay.person)).status, 403)
  let allow = new URL((await api('/allow?at=friends')).headers.get('location')!)
  assertEquals(allow.searchParams.get('grant'), gift!.eid)
  let prompt = await k.at(
    k.host,
    `/manage/${eveSpace.slug}/connections${allow.search}`,
    {
      headers: { cookie: eve.cookie },
    },
  )
  assertStringIncludes(await prompt.text(), 'Let Gift see your friends?')
  assertEquals((await change('source-grant')).status, 303)
  assertEquals((await read(APP_FRIENDS))[0].app_friends, {
    signed_in: true,
    allowed: true,
  })
  assertEquals(await read(APP_FRIEND, fay), [])
  let rows = await read(APP_FRIEND)
  assertEquals(rows.map((b: { entity: { eid: string } }) => b.entity.eid), [
    fay.person,
  ])
  assertEquals(rows[0].app_friend.presence, 'building')
  assertStringIncludes(rows[0].app_friend.avatar, 'data:image/svg+xml,')
  try {
    await saveAccount(k, fay, { hidden: true })
    assertEquals((await read(APP_FRIEND))[0].app_friend.presence, 'unknown')
  } finally {
    await saveAccount(k, fay, { hidden: false })
  }
  assertEquals((await invite(ann.person)).status, 400)
  assertEquals((await invite(fay.person, '../elsewhere')).status, 400)
  assertEquals(
    (await invite(fay.person, 'play#expedition', '?check=1')).status,
    200,
  )
  assertEquals((await said(fay)).filter((m) => m.invite).length, 0)
  assertEquals((await invite(fay.person)).status, 200)
  assertEquals((await invite(fay.person)).status, 200)
  let link = `https://${host}/gift/play#expedition`
  assertEquals((await said(fay)).flatMap((m) => m.invite ?? []), [link])
  assertStringIncludes(
    await (await updates(fay, faySpace.slug)).text(),
    `href="${link}"`,
  )
  assertEquals((await change('source-revoke')).status, 303)
  assertEquals(await read(APP_FRIEND), [])
  assertEquals((await invite(fay.person)).status, 403)
  assertEquals((await change('source-grant')).status, 303)
  assertEquals((await read(APP_FRIEND)).length, 1)
  await change('source-revoke')
})
