// A private published app's sample store (D-134327), as yaks.app's Worker
// makes one: what a sample is, who reads it and when a publish keeps it are
// @yaks/platform/visits'; this reads what was published and stages the store.
//
// It is made at app_publish from the version's declaration, kept in the
// bucket beside its release (declaration.ts), and its seed files. The owner's
// own store is never read for it. It is staged the way a first deploy stages
// an app's store (tools.ts `published`): the words, the commands and the seed
// posted as a candidate over release '0', then selected by the first request
// that names the release.
import {
  type App,
  appStore,
  type Directory,
  releaseOf,
  type Space,
  storeAt,
  storeName,
} from './directory.ts'
import { type Declaration, declarationOf } from './declaration.ts'
import { ACCEPTED, storeOf } from './door.ts'
import { type Door } from '@yaks/durable-object/door'
import type { Env } from './env.ts'
import { r2RawObjects } from './lib/objects.ts'
import { KERNEL } from './meta.ts'
import { filesAt } from './release.ts'
import { applying } from './release-seed.ts'
import { seedy } from '@yaks/platform/files'
import { addressed } from '@yaks/platform/versions'
import {
  resampled,
  type Sample,
  sampleAt,
  sampling,
  seedOf,
} from '@yaks/platform/visits'

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
 * A declaration with the words its app borrows from a sibling (its store's
 * `/uses`, which no declaration carries) written in as its own, the way
 * erase.ts gives them to a borrower whose home goes. A sample, and every
 * visitor's copy of it, stands in no space and borrows from nobody.
 */
let alone = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  declared: Declaration,
): Promise<Declaration> => {
  let uses = JSON.parse(
    await asked(appStore(env.STORE, space, app), '/uses', {}, KERNEL),
  ) as Record<string, string>
  if (!Object.keys(uses).length) return declared
  let defs = { ...declared.vocab.$defs }
  for (let [name, slug] of Object.entries(uses)) {
    let home = await dir.app(space, slug)
    let schema = home &&
      (await declarationOf(env, space, home)).vocab.$defs?.[name]
    if (!schema) throw new Error(`${slug} has no declaration for ${name}`)
    defs[name] = schema
  }
  return { ...declared, vocab: { ...declared.vocab, $defs: defs } }
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
): Promise<Sample | null> => {
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
  let declared = await alone(
    env,
    dir,
    space,
    app,
    await declarationOf(env, space, {
      ...app,
      source: version.source ?? null,
      declaration: release,
    }),
  )
  let seed = seedOf(declared, files)
  let next = resampled(app.demo, { seed, version: number, release })
  if (next.to == 'kept') return next.sample
  if (next.to == 'moved') {
    let demo = next.sample
    await dir.stamp({ entities: [{ entity: { eid: app.eid }, demo }] })
    return demo
  }
  let store = sampleAt(storeName(space, app), crypto.randomUUID())
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
  await (await import('./seed.ts')).sow(
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
  let r = await storeOf(env.STORE, store)('/', { method: 'DELETE' }, KERNEL)
  if (!r.ok) throw new Error(await r.text())
  await r.body?.cancel()
}
