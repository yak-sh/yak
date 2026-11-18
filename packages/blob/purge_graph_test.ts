import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { ddl, journal, log } from '@yaks/journal'
import { history } from '@yaks/journal/graph'
import { purgeEntities, restoreTrash } from '@yaks/graph/trash'
import { equal, test } from '@yaks/testing'
import { address } from './store.ts'
import { blog, fixture, mem } from './testing.ts'
import { blobRead, blobSchema, sqliteBlobs } from './sqlite.ts'
import { blobs } from './plugin.ts'

let alone = fixture()
await alone.g.apply([{
  entity: { eid: 'alone' },
  post: { body: 'The only copy.' },
}])
await alone.g.apply([{ entity: { eid: 'alone' }, post: null }], {
  trusted: true,
  expiring: true,
})

test('expiration retains body bytes until an explicit graph history purge', async () => {
  equal(await alone.blobs.has(address('The only copy.')), true)
  await purgeEntities(alone.g, ['alone'])
  equal(await alone.blobs.has(address('The only copy.')), false)
})

let shared = fixture()
await shared.g.apply(['first', 'second'].map((eid) => ({
  entity: { eid },
  post: { body: 'Shared precious text.' },
})))
await shared.g.apply(['first', 'second'].map((eid) => ({
  entity: { eid },
  $delete: true,
})))

test('purging one trashed owner preserves shared bytes and the other owner can restore', async () => {
  await purgeEntities(shared.g, ['first'])
  equal(await shared.blobs.has(address('Shared precious text.')), true)
  let [entry] = await shared.db.trash!(['second'])
  await restoreTrash(shared.g, entry)
  equal((await shared.g.get(['second']))[0].post, {
    body: 'Shared precious text.',
  })
})

let live = fixture()
await live.g.apply(['gone', 'held'].map((eid) => ({
  entity: { eid },
  post: { body: 'Still live.' },
})))
await live.g.apply([{ entity: { eid: 'gone' }, $delete: true }])

test('purging a trashed owner keeps a live owner’s pooled body readable', async () => {
  await purgeEntities(live.g, ['gone'])
  equal((await live.g.get(['held']))[0].post, { body: 'Still live.' })
})

let historic = (() => {
  let driver = mem()
  let derived = blobRead(blog)
  let db = storage(driver, blog, {
    derived,
    history: history({ versions: true }),
  })
  db.install()
  for (let stmt of [...blobSchema(), ...ddl()]) driver.query(stmt)
  let bytes = sqliteBlobs(db.statements)
  let records = log({ rows: (s) => driver.query(s), derived })
  let g = graph({
    storage: db,
    vocab: blog,
    plugins: [
      blobs(blog, bytes),
      journal(records, blog, { record: { changes: true, values: false } }),
    ],
  })
  return { db, bytes, g }
})()
await historic.g.apply(['erased', 'remembered'].map((eid) => ({
  entity: { eid },
  post: { body: 'An earlier edition.' },
})))
await historic.g.apply([{
  entity: { eid: 'remembered' },
  post: { body: 'The current edition.' },
}, { entity: { eid: 'erased' }, $delete: true }])
await historic.db.purgeTrash!(['remembered'])

test('purging one owner keeps shared historical bytes until the last owner’s history is purged', async () => {
  await purgeEntities(historic.g, ['erased'])
  equal(await historic.bytes.has(address('An earlier edition.')), true)
  await purgeEntities(historic.g, ['remembered'])
  equal(await historic.bytes.has(address('An earlier edition.')), false)
  equal((await historic.g.get(['remembered']))[0].post, {
    body: 'The current edition.',
  })
})
