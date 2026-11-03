// Trash retains an app's resources while its address belongs to the next app.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { call, type Ctx } from './tools.ts'
import { appStore, directory, storeName } from './directory.ts'
import * as dirPart from './directory.ts'
import { platform } from './testing.ts'
import { r2Objects } from './lib/objects.ts'
import { blobPrefix } from './blob-key.ts'
import { publicPrefix } from './public-files.ts'
import { holding } from './held.ts'

let fixture = async (reuse = false) => {
  let { env } = platform('trash-address')
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) })
  let ctx: Ctx = { env, dir, person: crypto.randomUUID() }
  await call(ctx, 'space_new', { slug: 'ada', title: 'Ada' })
  await call(ctx, 'app_new', { space: 'ada', slug: 'notes', title: 'Notes' })
  let space = (await dir.space('ada'))!
  let app = (await dir.app(space, 'notes'))!
  await call(ctx, 'app_files', {
    space: 'ada',
    app: 'notes',
    files: [
      { path: 'index.html', content: '<h1>Kept</h1>' },
      {
        path: 'vocab.json',
        content: JSON.stringify({
          $defs: {
            note: {
              component: true,
              type: 'object',
              properties: { text: { type: 'string' } },
            },
          },
        }),
      },
    ],
  })
  await call(ctx, 'app_deploy', { space: 'ada', app: 'notes' })
  app = (await dir.app(space, 'notes'))!
  let row = crypto.randomUUID()
  let saved = await appStore(env.STORE, space, app)('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: row }, note: { text: 'kept' } }]),
  }, { 'x-yak-role': 'owner', 'x-yak-person': ctx.person })
  assertEquals(saved.status, 200, await saved.text())
  let deploys = await dir.deploys(app)
  // A legacy app's mutable files, uploads and published bytes all shared its
  // address prefix. This is the shape a deployed directory already holds.
  await dir.apply({
    entities: [{ entity: { eid: app.eid }, app: { files: null, blobs: null } }],
  })
  app = (await dir.app(space, 'notes'))!
  let blobs = r2Objects(env.BLOBS)
  for (let path of ['draft.txt', 'blobs/image', 'public/page.html']) {
    await blobs.put(
      `${space.store}/notes/${path}`,
      new TextEncoder().encode('kept'),
    )
  }
  await appStore(env.STORE, space, app)('/vocab', {
    method: 'POST',
    body: '{}',
  })
  let deleted = await call(ctx, 'app_delete', { space: 'ada', app: 'notes' })
  if (reuse) {
    await call(ctx, 'app_new', {
      space: 'ada',
      slug: 'notes',
      title: 'New notes',
    })
  }
  return { ctx, dir, env, space, app, blobs, deleted, row, deploys }
}
let free = await fixture()
let restoring = await fixture()
let reuse = await fixture(true)
let chosen = await fixture(true)
let renamed = await fixture()

test('trash releases the slug while retaining every owned byte and store', async () => {
  let { dir, env, space, app, blobs, deleted } = free
  assertEquals(await dir.app(space, 'notes'), null)
  let kept = (await dir.appAt(app.eid))!.app
  assertEquals(kept.slug, 'notes')
  assertEquals(storeName(space, kept), storeName(space, app))
  assertStringIncludes(deleted.text, app.eid)
  let prefix = `${space.store}/notes`
  assertEquals(
    new TextDecoder().decode(await blobs.get(prefix + '/draft.txt')),
    'kept',
  )
  assertEquals(
    new TextDecoder().decode(
      await blobs.get(blobPrefix(space, kept) + 'image'),
    ),
    'kept',
  )
  assertEquals(
    new TextDecoder().decode(
      await blobs.get(publicPrefix(space, kept) + 'page.html'),
    ),
    'kept',
  )
  assertEquals(
    new TextDecoder().decode(
      await blobs.get(`${space.store}/notes/blobs/image`),
    ),
    'kept',
  )
  assertEquals((await appStore(env.STORE, space, kept)('/vocab')).status, 404)
})

test('restore returns to the old address when it is free', async () => {
  let { ctx, dir, env, space, app, deploys, row } = restoring
  await call(ctx, 'app_restore', { space: 'ada', app: app.eid })
  let restored = (await dir.app(space, 'notes'))!
  assertEquals(restored.eid, app.eid)
  assertEquals(await dir.deploys(restored), deploys)
  let saved = await appStore(env.STORE, space, restored)(
    '/query?q=' + encodeURIComponent('.entity.eid=' + row),
    {},
    { 'x-yak-role': 'owner', 'x-yak-person': ctx.person },
  )
  assertStringIncludes(await saved.text(), 'kept')
})

test('restore chooses a numbered address and leaves the replacement independent', async () => {
  let { ctx, dir, space, app, blobs } = reuse
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
  let restored = await call(ctx, 'app_restore', { space: 'ada', app: app.eid })
  assertStringIncludes(restored.text, '/notes-2/')
  assertEquals((await dir.app(space, 'notes-2'))!.eid, app.eid)
  assertEquals((await dir.app(space, 'notes'))!.eid, replacement.eid)
  assertEquals(await dir.former(space, 'notes'), null)
  await call(ctx, 'app_delete', { space: 'ada', app: app.eid, forever: true })
  assertEquals((await dir.app(space, 'notes'))!.eid, replacement.eid)
})

test('restore accepts a chosen address', async () => {
  let { ctx, dir, space, app } = chosen
  await call(ctx, 'app_restore', {
    space: 'ada',
    app: app.eid,
    slug: 'archive',
  })
  assertEquals((await dir.app(space, 'archive'))!.eid, app.eid)
})

test('a rename and a new app can take released and former addresses', async () => {
  let { ctx, dir, space } = renamed
  await call(ctx, 'app_new', { space: 'ada', slug: 'draft', title: 'Draft' })
  await call(ctx, 'app_set', { space: 'ada', app: 'draft', slug: 'notes' })
  let moved = (await dir.app(space, 'notes'))!
  assertEquals((await dir.former(space, 'draft'))!.eid, moved.eid)
  await call(ctx, 'app_new', {
    space: 'ada',
    slug: 'draft',
    title: 'Another draft',
  })
  assertEquals(await dir.former(space, 'draft'), null)
  assertEquals((await dir.app(space, 'notes'))!.eid, moved.eid)
})
