// A private published app's sample store (D-134327): a store of its own that
// holds the published version's seed and nothing else, which every stranger
// at the app reads until their first write gives them a store of their own.
//
// It is made at app_publish from what was published: the version's
// declaration, kept in the bucket beside its release (declaration.ts), and its
// seed files. The owner's own store is never read for it. It is staged the way
// a first deploy stages an app's store (tools.ts `published`): the words, the
// commands and the seed posted as a candidate over release '0', then selected
// by the first request that names the release. A republish that changed
// neither the declaration nor the seed keeps the store it has; one that
// changed either makes a new one, and the old one is emptied. A visitor's own
// store is a copy, so it never depends on the sample it came from.
import { sha256 } from '@yaks/graph/sha256'
import {
  type App,
  type Demo,
  type Directory,
  releaseOf,
  type Space,
  storeAt,
  storeName,
} from './directory.ts'
import { declarationOf } from './declaration.ts'
import { ACCEPTED, type Door, storeOf } from './door.ts'
import type { Env } from './env.ts'
import { r2RawObjects } from './lib/objects.ts'
import { filesAt } from './release.ts'
import { applying } from './release-seed.ts'
import { seedy, sow } from './seed.ts'
import { addressed, type Files } from './versions.ts'

/** Whether an app keeps a sample: a private app on offer. An open or public
 * app is one store everyone already shares. */
export let sampling = (app: App) => app.access == 'private' && !!app.published

/** What a sample is made from, as one sha: the declaration and the seed
 * files' own shas, so a republish that changed neither is the same sample. */
export let seedOf = (declared: unknown, files: Files) =>
  sha256(JSON.stringify([
    declared,
    Object.keys(files).filter(seedy).sort().map((path) => [path, files[path]]),
  ]))

let decoder = new TextDecoder()

// A store's answer, or the store's own sentence thrown: every refusal here is
// of something the app's own deploy already accepted, so it is ours.
let asked = async (
  door: Door,
  path: string,
  init: RequestInit,
  head: Record<string, string>,
) => {
  let r = await door(path, init, head)
  let text = await r.text()
  if (!r.ok) throw new Error(`sample store ${path}: ${text}`)
  return text
}

/**
 * The app's sample, made or kept, and written on the app as `demo`. `head`
 * vouches for the publisher, who the seed rows are written by. Answers the
 * sample, or null where the app keeps none.
 */
export let sampled = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  head: Record<string, string>,
): Promise<Demo | null> => {
  if (!sampling(app)) {
    await unsampled(env, dir, app)
    return null
  }
  let number = app.published!.version
  let version = (await dir.deploys(app)).find((v) => v.version == number)
  if (!version) throw new Error(`published v${number} has no kept release`)
  let raw = r2RawObjects(env.BLOBS)
  let files = version.source
    ? await filesAt(raw, version.source)
    : version.files
  // The declaration the published version serves under: the app's live
  // pointer while it is still the live version, its number otherwise.
  let release = app.version == number ? releaseOf(app) : String(number)
  let declared = await declarationOf(env, space, {
    ...app,
    source: version.source ?? null,
    declaration: release,
  })
  let seed = seedOf(declared, files)
  // The same words and seed at a new version keep the store, which the
  // strangers already in it go on reading.
  if (app.demo?.seed == seed) {
    if (app.demo.version == number && app.demo.release == release) {
      return app.demo
    }
    let demo = { ...app.demo, version: number, release }
    await dir.stamp({ entities: [{ entity: { eid: app.eid }, demo }] })
    return demo
  }
  let store = `${storeName(space, app)}/demo/${crypto.randomUUID()}`
  let serving = storeAt(space, app, env).app
  let draft = storeOf(env.STORE, store, { ...serving, release, base: '0' })
  await asked(draft, '/vocab', {
    method: 'POST',
    body: JSON.stringify(declared.vocab),
  }, {
    ...head,
    [ACCEPTED]: JSON.stringify(Object.keys(declared.vocab.$defs ?? {})),
  })
  await asked(draft, '/tools', {
    method: 'POST',
    body: JSON.stringify(declared.tools),
  }, head)
  await sow(
    await Promise.all(
      Object.keys(files).filter(seedy).map(async (path) => ({
        path,
        text: decoder.decode(
          (await raw.read(addressed(files[path]))) ?? undefined,
        ),
      })),
    ),
    applying(draft, head, '/seed'),
  )
  // The first request that names the release selects it, seed and all.
  await asked(storeOf(env.STORE, store, { ...serving, release }), '/vocab', {
    method: 'GET',
  }, head)
  let demo = { store, seed, version: number, release }
  await dir.stamp({ entities: [{ entity: { eid: app.eid }, demo }] })
  if (app.demo) await cleared(env, app.demo.store)
  return demo
}

/** The app's sample taken off it and emptied, where it has one. */
export let unsampled = async (env: Env, dir: Directory, app: App) => {
  if (!app.demo) return
  await dir.stamp({ entities: [{ entity: { eid: app.eid }, demo: null }] })
  await cleared(env, app.demo.store)
}

/** A sample store's rows and state gone (erase.ts `emptied` does the same for
 * an app's own store). */
export let cleared = async (env: Env, store: string) => {
  let r = await storeOf(env.STORE, store)('/', { method: 'DELETE' }, {
    'x-yak-kernel': '1',
  })
  if (!r.ok) throw new Error(await r.text())
  await r.body?.cancel()
}
