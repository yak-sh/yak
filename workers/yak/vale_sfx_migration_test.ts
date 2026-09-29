// The one-time source switch is guarded by the release audit and remains
// resumable if the directory committed before the admin door answered.
import { assertEquals, assertRejects } from '@std/assert'
import { token } from '@yaks/graph'
import { r2Objects } from './lib/objects.ts'
import { bucket } from './testing.ts'
import { valeMigration } from './vale_sfx_migration.ts'

Deno.test('repackaged live Vale release serves its revised source', async () => {
  let eid = '0f562744-e91e-4958-bfb7-1ef06af52dc2'
  let before = `yourname/.releases/${eid}/before`
  let after = `yourname/.releases/${eid}/after`
  let app = {
    eid,
    slug: 'vale',
    version: 2,
    source: before,
    draft: null,
    fence: null,
  }
  let release = {
    eid: 'release',
    version: 2,
    source: after,
    files: { 'samples.ts': 'revised' },
  }
  let blobs = bucket()
  let raw = r2Objects(blobs.r2 as never)
  let index = { 'samples.ts': { key: 'one' } }
  await raw.put(
    `${before}.json`,
    new TextEncoder().encode(JSON.stringify(index)),
  )
  await raw.put(
    `${after}.json`,
    new TextEncoder().encode(JSON.stringify(index)),
  )
  await raw.put(
    `audit/vale-sfx-44666/releases/${release.eid}.json`,
    new TextEncoder().encode(JSON.stringify({
      app: eid,
      version: 2,
      before: { source: before, index },
      after: { source: after, index, files: release.files },
    })),
  )
  let writes = 0
  let dir = {
    personAt: () => Promise.resolve('admin'),
    appAt: () => Promise.resolve({ space: { slug: 'yourname' }, app }),
    deploys: () => Promise.resolve([release]),
    stamp: (change: {
      entities: {
        app: { source: string }
        $was: { app: { source: string } }
      }[]
    }) => {
      assertEquals(change.entities[0].$was.app.source, token(before))
      app.source = change.entities[0].app.source
      writes++
      return Promise.resolve(change)
    },
  }
  let ctx = { person: 'admin', dir, env: { BLOBS: blobs.r2 } }
  let args = { phase: 'activate', app: eid }
  assertEquals(
    (await valeMigration.run(ctx as never, { ...args, check: true })).text,
    'ready to serve revised v2',
  )
  assertEquals(app.source, before)
  await valeMigration.run(ctx as never, args)
  assertEquals(app.source, after)
  assertEquals(
    (await valeMigration.run(ctx as never, args)).text,
    'v2 already serves its revised source',
  )
  assertEquals(writes, 1)
  app.source = 'unrelated'
  await assertRejects(() => valeMigration.run(ctx as never, args))
})
