import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type App, directoryOf, storeAt } from './directory.ts'
import { storeOf } from './door.ts'
import type { Env } from './env.ts'
import { connector, fresh, owned, txt, vocabFile } from './probe.ts'

let env!: Env
let k = await fresh({}, (e) => env = e)
let dir = directoryOf(env.STORE)
let agent = connector(k, k.owner.cookie)
await owned(k, k.owner.person, 'samples', 'Samples')
let seed = (title: string) => ({
  path: 'seed.json',
  content: JSON.stringify([{ entity: { eid: '$a' }, note: { title } }]),
})
let files = (title: string) => [
  { path: 'index.html', content: '<h1>Notes</h1>' },
  { path: 'vocab.json', content: vocabFile({ note: { title: txt } }) },
  seed(title),
]
for (let [slug, access] of [['notes', 'private'], ['wall', 'open']]) {
  await agent.tool('app_new', { space: 'samples', slug, title: slug, access })
  await agent.tool('app_files', {
    space: 'samples',
    app: slug,
    files: files('Sample note'),
  })
  await agent.tool('app_deploy', { space: 'samples', app: slug })
}
await agent.tool('graph_apply', {
  app: 'samples/notes',
  entities: [{ entity: { eid: '$mine' }, note: { title: 'Owner only' } }],
})

let space = (await dir.space('samples'))!
let read = async (slug: string) => (await dir.app(space, slug))!
let titles = async (app: App) => {
  let r = await storeOf(env.STORE, app.demo!.store, {
    ...storeAt(space, app, env).app,
  })('/query?q=.note', {}, {
    'x-yak-person': k.owner.person,
    'x-yak-role': 'owner',
  })
  let rows: { note: { title: string } }[] = await r.json()
  return rows.map((row) => row.note.title).sort()
}
let publish = (app: string, more = {}) =>
  agent.tool('app_publish', { space: 'samples', app, name: app, ...more })

await publish('notes')
let first = await read('notes')
let firstRows = await titles(first)
await publish('notes', {})
let same = await read('notes')
await agent.tool('app_files', {
  space: 'samples',
  app: 'notes',
  files: [seed('New sample')],
})
await agent.tool('app_deploy', { space: 'samples', app: 'notes' })
await publish('notes', {})
let moved = await read('notes')
let movedRows = await titles(moved)
await publish('wall')
let open = await read('wall')
await publish('notes', { demo: false })
let off = await read('notes')
await k.stop()

test('a private published app gets a sample store holding its seed, not its data', () => {
  assert(first.demo)
  assertNotEquals(first.demo.store, first.store)
  assertEquals(firstRows, ['Sample note'])
})

test('a republish keeps the sample until the seed changes', () => {
  assertEquals(same.demo, first.demo)
  assertNotEquals(moved.demo!.store, first.demo!.store)
  assertEquals(movedRows, ['New sample'])
})

test('an open app keeps no sample, and demo: false takes one off', () => {
  assertEquals(open.demo, null)
  assertEquals(off.demo, null)
})
