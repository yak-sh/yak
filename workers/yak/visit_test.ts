import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from '@std/assert'
import { test } from '@yaks/testing'
import { directoryOf } from './directory.ts'
import type { Env } from './env.ts'
import { client, connector, fresh, signIn, txt, vocabFile } from './probe.ts'
import { KERNEL, meta } from './meta.ts'
import { crowded, KEPT, lapsed, MOVED, visits } from './visit.ts'
import { stores } from './sweep.ts'
import { closed, collected } from './erase.ts'
import { BOT } from './lib/bots.ts'

let env!: Env
let k = await fresh({}, (e) => env = e)
let dir = directoryOf(env.STORE)
let agent = connector(k, k.owner.cookie)
await agent.tool('app_new', {
  space: 'owner',
  slug: 'notes',
  title: 'Notes',
  access: 'private',
})
await agent.tool('app_files', {
  space: 'owner',
  app: 'notes',
  files: [
    { path: 'index.html', content: '<h1>Notes</h1>' },
    { path: 'vocab.json', content: vocabFile({ note: { title: txt } }) },
    {
      path: 'seed.json',
      content: JSON.stringify([{
        entity: { eid: '$a' },
        note: { title: 'Sample' },
      }]),
    },
  ],
})
await agent.tool('app_deploy', { space: 'owner', app: 'notes' })
await agent.tool('graph_apply', {
  app: 'owner/notes',
  entities: [{ entity: { eid: '$mine' }, note: { title: 'Owner only' } }],
})
await agent.tool('app_publish', {
  space: 'owner',
  app: 'notes',
  name: 'notes',
})

let host = `owner.${k.host}`
let titles = async (c: ReturnType<typeof client>) =>
  (await c.get('q=.note')).map((r) => (r.note as { title: string }).title)
    .sort()
let adaIn = await signIn(k)
let ada = client(k, host, 'notes', adaIn.cookie)
let bo = client(k, host, 'notes', (await signIn(k)).cookie)
let owner = client(k, host, 'notes', k.owner.cookie)
let nobody = client(k, host, 'notes')

let sampleBefore = await titles(ada)
let me = await (await k.at(host, '/notes/api/me', { headers: ada.headers }))
  .json()
let page = async (headers: HeadersInit) =>
  await (await k.at(host, '/notes/', { headers })).text()
let adaPage = await page(ada.headers)
let ownerPage = await page(owner.headers)
let ownerMe = await (await k.at(host, '/notes/api/me', {
  headers: owner.headers,
})).json()
let first = await ada.post([{ entity: { eid: '$n' }, note: { title: 'Mine' } }])
let firstMoved = first.headers.get(MOVED)
await first.body?.cancel()
let adaAfter = await titles(ada)
let sample = (await titles(bo)).join()
let ownerRows = await titles(owner)
let [seedRow] = await ada.get('q=.note.title=Sample')
let edited = await ada.post([{
  entity: { eid: seedRow.entity.eid },
  note: { title: 'Sample, changed' },
}])
let editStatus = edited.status
await edited.body?.cancel()
let adaEdited = await titles(ada)
let second = await ada.post([{ entity: { eid: '$m' }, note: { title: 'Two' } }])
let secondMoved = second.headers.get(MOVED)
await second.body?.cancel()

// One browser's two writes at once make one store.
let [x, y] = await Promise.all([
  bo.post([{ entity: { eid: '$x' }, note: { title: 'X' } }]),
  bo.post([{ entity: { eid: '$y' }, note: { title: 'Y' } }]),
])
let boStatuses = [x.status, y.status]
await x.body?.cancel()
await y.body?.cancel()
let boRows = await titles(bo)
let signedOut = (await nobody.get('q=.note')) as unknown as {
  error?: { code: string }
}
let app = (await dir.app((await dir.space('owner'))!, 'notes'))!
let vias = (await meta(env).query('.visit')).length

// Ada installs, keeping what she made.
let install = () =>
  k.at(k.host, '/install?name=notes', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: adaIn.cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: '',
  })
let offered = await (await k.at(k.host, '/install?name=notes', {
  headers: { cookie: adaIn.cookie },
})).text()
let installed = await install()
let kept = new URL(installed.headers.get('location') ?? 'https://none/')
await installed.body?.cancel()
let again = await install()
let againAt = again.headers.get('location')
await again.body?.cancel()
let adopted = client(
  k,
  kept.host,
  kept.pathname.split('/')[1],
  adaIn.cookie,
)
let adoptedRows = await titles(adopted)
let adoptedWrite = await adopted.post([
  { entity: { eid: '$k' }, note: { title: 'Kept' } },
])
let adoptedStatus = adoptedWrite.status
await adoptedWrite.body?.cancel()
let sent = await k.at(host, '/notes/', {
  redirect: 'manual',
  headers: { cookie: adaIn.cookie, 'sec-fetch-mode': 'navigate' },
})
await sent.body?.cancel()
let demoAfter = await titles(ada)
let adoptedAgain = await titles(adopted)

// What a sweep reaches, and what makes no store.
let listed = (await stores(env)).map((s) => s.at)
// Ada's store is her app's now, so it is neither a visit nor counted.
let crowding = [await crowded(env, app.eid, 1), await crowded(env, app.eid, 2)]
let cy = await signIn(k, `cy-${crypto.randomUUID()}${BOT}`)
let cyc = client(k, host, 'notes', cy.cookie)
env.BIRTH_RATE = { limit: () => Promise.resolve({ success: false }) }
let held = await cyc.post([{ entity: { eid: '$c' }, note: { title: 'C' } }])
let heldAnswer = { status: held.status, ...await held.json() }
delete env.BIRTH_RATE
let before = new Set((await visits(env)).map((g) => g.eid))
let made = await cyc.post([{ entity: { eid: '$c' }, note: { title: 'C' } }])
await made.body?.cancel()
let cys = (await meta(env).query('.visit ?edge'))
  .find((r) => !before.has(r.entity.eid))!
await meta(env).apply([{
  entity: { eid: (cys.edge as { from: string }).from },
  browser: { by: cy.person },
}], KERNEL)

let claimedLapsed = (await lapsed(env, new Date(Date.now() + 2 * KEPT)))
  .filter((g) => g.eid == cys.entity.eid).length
// A closed account takes its store; a store nobody claimed lasts 90 days.
await closed(env, dir, cy.email, { person: k.owner.person, role: 'owner' })
let afterClosing = (await visits(env)).length
let soon = (await lapsed(env)).length
let later = new Date(Date.now() + KEPT + 86_400_000)
let lapsing = (await lapsed(env, later)).length
await collected(env, later)
let afterSweep = (await visits(env)).length
let adaAgain = await titles(ada)
let adoptedSwept = await titles(adopted)
await k.stop()

test('a stranger reads the sample and hears they may write', () => {
  assertEquals(sampleBefore, ['Sample'])
  assertEquals(me.writes, true)
  assertEquals(me.visit, { kept: false })
  assertEquals(ownerMe.visit, null)
})

test('a stranger’s page wears the bar that keeps it, and a member’s none', () => {
  assertStringIncludes(
    adaPage,
    `data-yak-keep="https://${k.host}/install?name=notes" data-yak-keep-says="Keep it"`,
  )
  assert(!ownerPage.includes('data-yak-keep'))
})

test('their first write gives them a store of their own, and goes there', () => {
  assertEquals(firstMoved, '1')
  assertEquals(adaAfter, ['Mine', 'Sample'])
  assertEquals(secondMoved, null)
})

test('a seed row is theirs to change in their store', () => {
  assertEquals(editStatus, 200)
  assertEquals(adaEdited, ['Mine', 'Sample, changed'])
})

test('nobody else sees it: not the owner, not another stranger', () => {
  assertEquals(sample, 'Sample')
  assertEquals(ownerRows, ['Owner only', 'Sample'])
})

test('two writes at once make one store', () => {
  assertEquals(boStatuses, [200, 200])
  assertEquals(boRows, ['Sample', 'X', 'Y'])
  assertEquals(vias, 2)
})

test('the sample is not the app’s store, and signed out is still sign-in', () => {
  assert(app.demo)
  assertNotEquals(app.demo.store, app.store)
  assertEquals(signedOut.error?.code, 'not_a_reader')
})

test('a sweep reaches the sample and every visitor store', () => {
  assert(listed.includes('owner/notes sample'))
  assertEquals(listed.filter((at) => at == 'owner/notes visit').length, 1)
})

test('past its rate or its cap, a first write is asked to sign up', () => {
  assertEquals(crowding, [true, false])
  assertEquals(heldAnswer.status, 429)
  assertEquals(heldAnswer.error.code, 'sign_up')
  assert(heldAnswer.error.signIn)
})

test('a closed account takes the store its browser was given', () => {
  assertEquals(claimedLapsed, 0)
  assertEquals(afterClosing, 2)
})

test('a store nobody claimed is erased after 90 days unused', () => {
  assertEquals([soon, lapsing], [0, 2])
  assertEquals(afterSweep, 0)
  assertEquals(adaAgain, ['Sample'])
})

test('installing keeps what they made, in their own app', () => {
  assertStringIncludes(offered, 'What you made in this browser comes with it')
  assertEquals(installed.status, 303)
  assertEquals(adoptedRows, ['Mine', 'Sample, changed', 'Two'])
  assertEquals(adoptedStatus, 200)
  assertEquals(adoptedAgain, ['Kept', 'Mine', 'Sample, changed', 'Two'])
})

test('installing twice is the one app, and the demo sends them to it', () => {
  assertEquals(againAt, kept.href)
  assertEquals(sent.status, 303)
  assertEquals(sent.headers.get('location'), kept.href)
  assertEquals(demoAfter, ['Sample'])
})

test('an installed visit is its app’s, and no sweep takes it', () => {
  assertEquals(adoptedSwept, ['Kept', 'Mine', 'Sample, changed', 'Two'])
})
