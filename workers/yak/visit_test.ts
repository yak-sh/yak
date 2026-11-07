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
import { meta } from './meta.ts'
import {
  crowded,
  KEPT,
  lapsed,
  MOVED,
  storeCookie,
  STORES,
  visits,
} from './visit.ts'
import { stores } from './sweep.ts'
import { closed, collected } from './erase.ts'
import { BOT } from '@yaks/platform/bots'

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
let boIn = await signIn(k)
let bo = client(k, host, 'notes', boIn.cookie)
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
let boClaimed = (await visits(env, { by: boIn.person })).length

// A browser nobody is signed in on: its cookie is all it is.
let opened = await k.at(host, '/notes/api/me')
let cookie = opened.headers.get('set-cookie')!.split(';')[0]
let meOut = await opened.json()
let out = client(k, host, 'notes', cookie)
let outBefore = await titles(out)
let outFirst = await out.post([{
  entity: { eid: '$o' },
  note: { title: 'Out' },
}])
let outMoved = outFirst.headers.get(MOVED)
await outFirst.body?.cancel()
let outAfter = await titles(out)
let [outSeed] = await out.get('q=.note.title=Sample')
let outEdit = await out.post([{
  entity: { eid: outSeed.entity.eid },
  note: { title: 'Sample, mine' },
}])
let outEditStatus = outEdit.status
await outEdit.body?.cancel()
let letter = await out.post([{
  entity: { eid: '$l' },
  doc: { title: 'Hi', body: 'From the app' },
  mail: {},
  deliver: { to: outSeed.entity.eid },
}])
let refused = [letter.status, (await letter.json()).error.message]
let ownerAfter = await titles(owner)
let nobodyRows = await titles(nobody)
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
let crowding = [await crowded(env, app.eid, 2), await crowded(env, app.eid, 3)]
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

// A browser that keeps the cookies its answers set, which say which stores it
// holds (visit.ts `ownOf`), and how many store hops each answer took.
let browser = (...start: string[]) => {
  let jar = new Map<string, string>()
  let keep = (c: string) => {
    let [pair] = c.split(';'), at = pair.indexOf('=')
    jar.set(pair.slice(0, at), pair.slice(at + 1))
  }
  start.forEach(keep)
  let at = async (path: string, init: RequestInit = {}) => {
    let cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ')
    let res = await k.at(host, `/notes${path}`, {
      ...init,
      headers: { ...init.headers as object, ...cookie ? { cookie } : {} },
    })
    res.headers.getSetCookie().forEach(keep)
    let hops = Number(
      res.headers.get('server-timing')?.match(/(?:^|, )hops;dur=(\d+)/)?.[1],
    )
    return { res, hops }
  }
  let rows = async () => {
    let { res, hops } = await at('/api/query?q=.note')
    let titles = ((await res.json()) as { note: { title: string } }[])
      .map((r) => r.note.title).sort()
    return { titles, hops }
  }
  let write = async (title: string) => {
    let { res } = await at('/api/apply', {
      method: 'POST',
      body: JSON.stringify([{ entity: { eid: '$w' }, note: { title } }]),
    })
    await res.body?.cancel()
    return res.headers.get(MOVED)
  }
  return { at, rows, write, jar }
}
let dee = browser()
await (await dee.at('/')).res.body?.cancel()
let deeListed = [dee.jar.has(STORES), dee.jar.has(storeCookie(app.eid))]
let deeSample = await dee.rows()
let deeMoved = await dee.write('Dee')
let deeHolds = dee.jar.get(storeCookie(app.eid)) == dee.jar.get(STORES)
let deeOwn = await dee.rows()
// Bo's store is from before the cookies: his browser has none.
let boBrowser = browser(boIn.cookie)
let boFirst = await boBrowser.rows()
let boListed =
  boBrowser.jar.get(storeCookie(app.eid)) == boBrowser.jar.get(STORES)
let boNext = await boBrowser.rows()
// Cookies another instrument was given say nothing about this one.
let crossed = browser(
  boIn.cookie,
  `${STORES}=${dee.jar.get(STORES)}`,
)
let boCrossed = await crossed.rows()
// The same browser asking the same thing, with and without its cookies.
let eve = browser()
await (await eve.at('/')).res.body?.cancel()
let eveSaid = await eve.rows()
let eveSilent = await browser(`yak_session=${eve.jar.get('yak_session')}`)
  .rows()
let stranger = browser()
let strangerFirst = await stranger.rows()
let strangerNext = await stranger.rows()
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
  assertEquals(vias, 3)
})

test('a signed-in stranger’s store is theirs from its first write', () => {
  assertEquals(boClaimed, 1)
})

test('the sample is not the app’s store', () => {
  assert(app.demo)
  assertNotEquals(app.demo.store, app.store)
})

test('signed out, a browser reads the sample and its first write gives it a store', () => {
  assertEquals(meOut.writes, true)
  assertEquals(outBefore, ['Sample'])
  assertEquals(outMoved, '1')
  assertEquals(outAfter, ['Out', 'Sample'])
  assertEquals(outEditStatus, 200)
  assertEquals(nobodyRows, ['Sample'])
  assertEquals(ownerAfter, ['Owner only', 'Sample'])
})

test('a visitor sends no mail from the app’s address', () => {
  assertEquals(refused[0], 403)
  assertStringIncludes(refused[1], 'may not write deliver')
})

test('a sweep reaches the sample and every visitor store', () => {
  assert(listed.includes('owner/notes sample'))
  assertEquals(listed.filter((at) => at == 'owner/notes visit').length, 2)
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

test('a store nobody claimed is erased after 90 days unused, and a claimed one kept', () => {
  assertEquals([soon, lapsing], [0, 1])
  assertEquals(afterSweep, 1)
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

test('a browser says which stores it holds, and is read whole once when it says nothing', () => {
  assertEquals(deeListed, [true, false])
  assertEquals(deeSample.titles, ['Sample'])
  assertEquals(deeMoved, '1')
  assert(deeHolds)
  assertEquals(deeOwn.titles, ['Dee', 'Sample'])
  assertEquals(boFirst.titles, ['Sample', 'X', 'Y'])
  assert(boListed)
  assertEquals(boNext.titles, ['Sample', 'X', 'Y'])
  assertEquals(boCrossed.titles, ['Sample', 'X', 'Y'])
})

test('a browser whose cookies say it holds no store of the app asks the directory nothing', () => {
  assertEquals([eveSaid.titles, eveSilent.titles], [['Sample'], ['Sample']])
  assertEquals(eveSaid.hops + 1, eveSilent.hops)
})

test('a browser that came with no cookie asks the directory nothing of its stores', () => {
  assertEquals(strangerFirst.titles, ['Sample'])
  assertEquals(strangerFirst.hops, strangerNext.hops)
  assert(stranger.jar.has(STORES))
})
