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
import { MOVED } from './visit.ts'

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
let ada = client(k, host, 'notes', (await signIn(k)).cookie)
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
