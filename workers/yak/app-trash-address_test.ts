// Trash retains an app's resources while its address belongs to the next app.
// Address decisions use RAM directory rows; dormant app rows stay in SQLite.
// Each case is a space of its own.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { call, type Ctx } from './tools.ts'
import { appStore, storeName } from './directory.ts'
import { declared } from './directory-fixture.ts'
import { platform } from './directory-rows-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import { operators } from './operator-service-probe.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import { platform as isolated } from './deploy-probe.ts'
import { r2Objects } from './lib/objects.ts'
import { blobPrefix } from './blob-key.ts'
import { publicPrefix } from './public-files.ts'
import { holding } from './held.ts'
import { effects } from './facets/trash-effects.ts'
import type { Stored } from './graph.ts'

let backed = platform('trash-address-backed', { BUILDER: operators }, {
  handlers: (env, graph) =>
    effects(undefined, { store: { meta: true, env, graph } as Stored }),
})
lifecycleStores(backed.env, (_name, from) => durable(from))
let addresses = isolated('trash-address')
let NOTE = {
  $defs: {
    note: {
      component: true,
      type: 'object',
      properties: { text: { type: 'string' } },
    },
  },
}

// A space of its own holding `notes`, a released app, in the shape a legacy
// directory holds: its mutable files, uploads and published bytes all under
// its address prefix. Then trashed, and its address taken again on `reuse`.
// Only a case that reads the app's rows back has its store woken to save one.
let fixture = async (
  slug: string,
  { reuse = false, saving = false, store = false } = {},
) => {
  let { env, dir } = saving || store ? backed : addresses
  let blobs = r2Objects(env.BLOBS)
  let person = crypto.randomUUID()
  let by = { 'x-yak-person': person, 'x-yak-role': 'owner' }
  let ctx: Ctx = { env, dir, person }
  await dir.apply({
    entities: [
      { entity: { eid: person }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: slug },
        space: { slug, store: slug },
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person, role: 'owner' },
      },
      {
        entity: { eid: '$app' },
        doc: { title: 'Notes' },
        app: {
          slug: 'notes',
          space: '$space',
          version: 1,
          access: 'private',
          store: `${slug}/notes.aaa111`,
        },
        former: { slug: 'notes' },
      },
      {
        entity: { eid: '$deploy' },
        deploy: { app: '$app', version: 1, files: '{}', worker: '' },
      },
    ],
  }, by)
  let space = (await dir.space(slug))!
  let app = (await dir.app(space, 'notes'))!
  await declared(env, space, app, { vocab: NOTE, tools: {} })
  let row = crypto.randomUUID()
  if (saving) {
    let store = appStore(env.STORE, space, app)
    let saved = await store('/apply', {
      method: 'POST',
      body: JSON.stringify([{ entity: { eid: row }, doc: { title: 'kept' } }]),
    }, by)
    assertEquals(saved.status, 200, await saved.text())
  }
  let deploys = await dir.deploys(app)
  await dir.apply({
    entities: [{ entity: { eid: app.eid }, app: { files: null, blobs: null } }],
  })
  app = (await dir.app(space, 'notes'))!
  for (let path of ['draft.txt', 'blobs/image', 'public/page.html']) {
    await blobs.put(`${slug}/notes/${path}`, new TextEncoder().encode('kept'))
  }
  let deleted = await call(ctx, 'app_delete', { space: slug, app: 'notes' })
  if (reuse) {
    await call(ctx, 'app_new', { space: slug, slug: 'notes', title: 'New' })
  }
  return { env, dir, blobs, ctx, slug, space, app, deleted, row, deploys, by }
}
let free = await fixture('free', { store: true })
let restoring = await fixture('restoring', { saving: true })
let reuse = await fixture('reuse', { reuse: true })
let chosen = await fixture('chosen')
let renamed = await fixture('renamed')

let text = async (blobs: ReturnType<typeof r2Objects>, key: string) =>
  new TextDecoder().decode((await blobs.get(key))!)

test('trash releases the slug while retaining every owned byte and store', async () => {
  let { env, dir, blobs, space, app, deleted, slug, by } = free
  assertEquals(await dir.app(space, 'notes'), null)
  let kept = (await dir.appAt(app.eid))!.app
  assertEquals(kept.slug, 'notes')
  assertEquals(storeName(space, kept), storeName(space, app))
  assertStringIncludes(deleted.text, app.eid)
  assertEquals(await text(blobs, `${slug}/notes/draft.txt`), 'kept')
  assertEquals(await text(blobs, blobPrefix(space, kept) + 'image'), 'kept')
  assertEquals(
    await text(blobs, publicPrefix(space, kept) + 'page.html'),
    'kept',
  )
  assertEquals(await text(blobs, `${slug}/notes/blobs/image`), 'kept')
  // Its store is kept, answering nothing while it is in the trash.
  let words = await appStore(env.STORE, space, kept)('/vocab', {}, by)
  assertEquals(words.status, 404)
  await words.body?.cancel()
})

test('restore returns to the old address when it is free', async () => {
  let { env, dir, ctx, slug, space, app, deploys, row, by } = restoring
  await call(ctx, 'app_restore', { space: slug, app: app.eid })
  let restored = (await dir.app(space, 'notes'))!
  assertEquals(restored.eid, app.eid)
  assertEquals(deploys.map((d) => d.version), [1])
  assertEquals(await dir.deploys(restored), deploys)
  let saved = await appStore(env.STORE, space, restored)(
    '/query?q=' + encodeURIComponent('.entity.eid=' + row),
    {},
    by,
  )
  assertStringIncludes(await saved.text(), 'kept')
})

test('restore chooses a numbered address and leaves the replacement independent', async () => {
  let { dir, blobs, ctx, slug, space, app } = reuse
  let replacement = (await dir.app(space, 'notes'))!
  assertEquals(await blobs.read(blobPrefix(space, replacement) + 'image'), null)
  let kept = (await dir.appAt(app.eid))!.app
  let sizes = new Map([[blobPrefix(space, kept) + 'image', 4], [
    blobPrefix(space, replacement) + 'image',
    7,
  ]])
  let totals = holding(space, [kept, replacement], sizes)
  assertEquals(totals.apps.get(kept.eid)?.files, 4)
  assertEquals(totals.apps.get(replacement.eid)?.files, 7)
  let restored = await call(ctx, 'app_restore', { space: slug, app: app.eid })
  assertStringIncludes(restored.text, '/notes-2/')
  assertEquals((await dir.app(space, 'notes-2'))!.eid, app.eid)
  assertEquals((await dir.app(space, 'notes'))!.eid, replacement.eid)
  assertEquals(await dir.former(space, 'notes'), null)
  await call(ctx, 'app_delete', { space: slug, app: app.eid, forever: true })
  assertEquals((await dir.app(space, 'notes'))!.eid, replacement.eid)
})

test('restore accepts a chosen address', async () => {
  let { dir, ctx, slug, space, app } = chosen
  await call(ctx, 'app_restore', { space: slug, app: app.eid, slug: 'archive' })
  assertEquals((await dir.app(space, 'archive'))!.eid, app.eid)
})

test('a rename and a new app can take released and former addresses', async () => {
  let { dir, ctx, slug, space } = renamed
  await call(ctx, 'app_new', { space: slug, slug: 'draft', title: 'Draft' })
  await call(ctx, 'app_set', { space: slug, app: 'draft', slug: 'notes' })
  let moved = (await dir.app(space, 'notes'))!
  assertEquals((await dir.former(space, 'draft'))!.eid, moved.eid)
  await call(ctx, 'app_new', { space: slug, slug: 'draft', title: 'Again' })
  assertEquals(await dir.former(space, 'draft'), null)
  assertEquals((await dir.app(space, 'notes'))!.eid, moved.eid)
})
