// The deploy history AS A REPOSITORY, held end to end over harness.ts's
// stand-in: a real directory, a real object store beside it, and real bytes in
// the bucket. What is pinned is the four promises a clone depends on — a deploy
// makes one commit, its tree IS the manifest, the next deploy follows the last
// one and moves the branch, and the sweep fills a hole without making a second
// commit where there is already one.
//
// It goes through `record()` (versions.ts) rather than calling the effect,
// because the whole claim is that a DEPLOY mints a commit: the plugin list, the
// registration, the cross-store write and the vocabulary all have to be right
// for this file to pass.
import { assert, assertEquals } from '@std/assert'
import { r2Blobs } from '../../src/blobs_r2.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { App, Space } from './directory.ts'
import { GIT_STORE, storeOf } from './door.ts'
import type { Env } from './env.ts'
import { backfilled, BODY, held, MAIN, refAt, refEid } from './gitobj.ts'
import { platform } from './harness.ts'
import { meta, metaOf } from './meta.ts'
import type { Who } from './session.ts'
import { pins, record, sha256 } from './versions.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let by = { 'x-yak-person': ADA, 'x-yak-role': 'owner' }
let WHO: Who = { person: ADA, role: 'owner' }

let utf8 = new TextEncoder()
let text = new TextDecoder()

// A space with an app in it, and the two doors this file reads through: the
// directory, and the git object store beside it.
let standing = async (env: Env) => {
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {}, doc: { title: 'Ada' } },
      {
        entity: { eid: '$space' },
        doc: { title: 'ada' },
        space: { slug: 'ada' },
      },
      {
        entity: { eid: '$app' },
        doc: { title: 'Recipes' },
        app: {
          slug: 'recipes',
          space: '$space',
          version: 0,
          access: 'public',
          store: 'ada/recipes.aaa111',
        },
      },
    ],
  }, by)
  let space = (await dir.space('ada'))! as Space
  let app = (await dir.app(space, 'recipes'))! as App
  return {
    dir,
    space,
    app,
    // The directory as gitobj.ts reads one, and the object store's own door.
    platform: held(meta(env)),
    git: metaOf(storeOf(env.STORE, GIT_STORE)),
  }
}

// One release: the files in the bucket where a deploy pins them, then the row
// that says the version happened — which is what wakes the effect.
let deploy = async (
  env: Env,
  app: App,
  version: number,
  files: Record<string, string>,
) => {
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  let blobs = r2Blobs(env.BLOBS)
  let manifest: Record<string, string> = {}
  for (let [path, body] of Object.entries(files)) {
    let bytes = utf8.encode(body)
    let sha = await sha256(bytes)
    manifest[path] = sha
    await pins(blobs, 'ada/recipes/').put(sha, bytes)
  }
  await record(dir, WHO, app, version, manifest, '')
  return manifest
}

// A committed object's own bytes, read back from where @yaks/git put them.
let bodyOf = async (env: Env, git: ReturnType<typeof metaOf>, oid: string) => {
  let [row] = await git.query(`.eid=${oid}`)
  assert(row, `no object ${oid}`)
  let sha = (row.blob as { sha: string }).sha
  let bytes = await r2Blobs(env.BLOBS).read(BODY + sha)
  assert(bytes, `no bytes for ${oid}`)
  return { row, body: text.decode(bytes) }
}

// What the app's branch points at right now, read the way the serving half
// will read it.
let headOf = (env: Env, app: App) => refAt(held(meta(env)), app.eid)

// Every commit about this app's deploys, and what each follows — the chain a
// clone walks, read from the directory and the object store together.
let chain = async (env: Env, git: ReturnType<typeof metaOf>, app: App) => {
  let out: { oid: string; parent: string | null; message: string }[] = []
  for (let d of await meta(env).query(`.deploy.app=${app.eid}`)) {
    let [c] = await meta(env).query(`.commit.target=${d.entity.eid}`)
    if (!c) continue
    let { body } = await bodyOf(env, git, c.entity.eid)
    out.push({
      oid: c.entity.eid,
      parent: body.match(/^parent ([0-9a-f]{40})$/m)?.[1] ?? null,
      message: (c.commit as { message: string }).message,
    })
  }
  return out
}

Deno.test('a deploy mints one commit whose tree is the manifest', async () => {
  let { env } = platform('a probe secret')
  let { app, git } = await standing(env)
  let manifest = await deploy(env, app, 1, {
    'index.html': '<h1>hi</h1>\n',
    'lib/app.js': 'export let go = () => 1\n',
  })

  let head = await headOf(env, app)
  assert(head, 'the branch stands at a commit')
  let { row, body } = await bodyOf(env, git, head)
  assertEquals((row.gitobj as { type: string }).type, 'commit')
  // The platform signed it; the person who deployed authored it, under the
  // pseudonymous address a public history gets until somebody opts out of it.
  assert(body.includes(`author Ada <${ADA}@users.yaks.app>`), body)
  assert(body.includes('committer yaks.app <git@yaks.app>'), body)
  assert(body.endsWith('deploy 1\n'), body)

  // The tree IS the manifest: one entry per top-level name, the blob under
  // `index.html` named by the very bytes the deploy pinned.
  let tree = body.match(/^tree ([0-9a-f]{40})$/m)![1]
  let entries = await git.query(`.entry!&.edge.from=${tree}`)
  assertEquals(
    entries.map((e) => (e.entry as { name: string }).name).sort(),
    ['index.html', 'lib'],
  )
  let page = entries.find((e) =>
    (e.entry as { name: string }).name == 'index.html'
  )!
  let [blob] = await git.query(`.eid=${(page.edge as { to: string }).to}`)
  assertEquals((blob.blob as { sha: string }).sha, manifest['index.html'])
})

Deno.test('the next deploy follows the last one and moves the branch', async () => {
  let { env } = platform('a probe secret')
  let { app, git } = await standing(env)
  await deploy(env, app, 1, { 'index.html': 'one\n' })
  let first = await headOf(env, app)
  await deploy(env, app, 2, { 'index.html': 'two\n' })
  let second = await headOf(env, app)

  assert(first && second && first != second, 'the branch moved')
  let { body } = await bodyOf(env, git, second)
  assertEquals(body.match(/^parent ([0-9a-f]{40})$/m)?.[1], first)
})

Deno.test('the sweep commits what nothing committed, once', async () => {
  let { env } = platform('a probe secret')
  let { app, git, platform: dir } = await standing(env)
  for (let v of [1, 2, 3]) {
    await deploy(env, app, v, { 'index.html': `v${v}\n` })
  }
  let full = await chain(env, git, app)
  assertEquals(full.length, 3)

  // The hole a deploy from before any of this leaves, and the hole a failed
  // effect leaves, are the same hole: the deploys stand, nothing says they
  // were committed. The objects stay — they are named by their own bytes.
  await dir.write([
    ...full.map((c) => ({ entity: { eid: c.oid }, commit: null })),
    { entity: { eid: refEid(app.eid, MAIN) }, ref: null },
  ])
  assertEquals((await chain(env, git, app)).length, 0)

  assertEquals(await backfilled(env, dir), 3)
  let again = await chain(env, git, app)
  assertEquals(again.map((c) => c.oid), full.map((c) => c.oid))
  assertEquals(again[0].parent, null)
  assertEquals(again[1].parent, again[0].oid)
  assertEquals(again[2].parent, again[1].oid)
  assertEquals(await headOf(env, app), again[2].oid)

  // And a second pass writes nothing: a deploy that has a commit is skipped.
  assertEquals(await backfilled(env, dir), 0)
})
