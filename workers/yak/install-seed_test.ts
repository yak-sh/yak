import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { connector, kernel, signIn, txt, unique, vocabFile } from './probe.ts'

let k = await kernel()
let publisher = connector(k, (await signIn(k)).cookie)
let name = unique('seeded-notes')
let fixed = crypto.randomUUID()
await publisher.tool('app_new', { slug: 'notes', title: 'Notes' })
await publisher.tool('app_files', {
  app: 'notes',
  files: [
    { path: 'index.html', content: '<h1>Notes</h1>' },
    {
      path: 'vocab.json',
      content: vocabFile({ notebook: { title: txt } }),
    },
    {
      path: 'seed.json',
      content: JSON.stringify([{
        entity: { eid: '$sample' },
        notebook: { title: 'Sample notebook' },
      }, {
        entity: { eid: fixed },
        notebook: { title: 'Fixed sample' },
      }]),
    },
  ],
})
await publisher.tool('app_deploy', { app: 'notes' })
await publisher.tool('app_publish', { app: 'notes', name })
let person = await signIn(k)
let installer = connector(k, person.cookie)
await installer.tool('app_install', { name })
let rows = (app = 'notes') =>
  installer.tool('graph_query', { app, q: '.notebook' }).then(JSON.parse)
let first =
  (await rows()).find((r: { entity: { eid: string } }) => r.entity.eid != fixed)
    .entity.eid
await installer.tool('graph_apply', {
  app: 'notes',
  entities: [
    { entity: { eid: first }, notebook: { title: 'My notebook' } },
    { entity: { eid: fixed }, notebook: { title: 'My fixed notebook' } },
  ],
})
await installer.tool('app_deploy', { app: 'notes' })
let second = await installer.tool('app_install', { name, as: 'second' })
let seeded = await rows('second')
let added = seeded.find((r: { entity: { eid: string } }) =>
  r.entity.eid != first && r.entity.eid != fixed
)
await installer.tool('graph_apply', {
  app: 'second',
  entities: [{
    entity: { eid: added.entity.eid },
    notebook: { title: 'Edited through second copy' },
  }],
})
await installer.tool('app_deploy', { app: 'second' })
let after = await rows()
let again = await rows('second')
await k.stop()

test('a second install seeds its component home and preserves the first copy’s edits', () => {
  assertStringIncludes(second, 'seeded 2 entities')
  assertEquals(seeded.length, 3)
  assertEquals(
    seeded.find((r: { entity: { eid: string } }) => r.entity.eid == first)
      .notebook.title,
    'My notebook',
  )
  assertEquals(added.notebook.title, 'Sample notebook')
  assertEquals(
    seeded.find((r: { entity: { eid: string } }) => r.entity.eid == fixed)
      .notebook.title,
    'My fixed notebook',
  )
})

test('borrowed seed rows remain writable through either copy and are seeded once', () => {
  assertEquals(after.length, 3)
  assertEquals(after, again)
  assertEquals(
    after.map((r: { notebook: { title: string } }) => r.notebook.title).sort(),
    ['Edited through second copy', 'My fixed notebook', 'My notebook'],
  )
})
