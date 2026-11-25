// Save in edit mode (edit-mode.ts): the snippets a member drafted on an app's
// page, set in its copy.json (@yaks/copy) and released. A private static app
// can carry its declaration and publish the changed files in one commit.
// Both paths record a version and merge against the release they replace.
//
// Undo is app_rollback's path: the release Save made goes back to the one it
// replaced, while it is still the live one.
import { parse, same, set, type Value, valueAt } from '@yaks/copy'
import { seedy } from '@yaks/platform/files'
import {
  addressed,
  BUILT,
  deployedOver,
  type Files,
} from '@yaks/platform/versions'
import type { Door } from '@yaks/durable-object/door'
import { Stale } from '@yaks/graph/errors'
import { declarationOf, keepDeclaration } from './declaration.ts'
import { background, caught } from './defects.ts'
import type { App, Space } from './directory.ts'
import { r2RawObjects } from './lib/objects.ts'
import { COPY } from './page-copy.ts'
import { atRelease, filesOf, staged } from './release.ts'
import type { Who } from './session.ts'
import { clock } from './timing.ts'
import { type Ctx, refuse } from './tool.ts'
import {
  fullAt,
  hashed,
  released,
  releaseNotice,
  releaseUpdate,
} from './tools.ts'
import { overtaken, record, releaseOf, versions, waiting } from './versions.ts'
import { served } from './written.ts'

/** What a save answers: the version it released, or the live one where
 * nothing it was sent differed, and the keys it changed. */
export type Saved = { version: number | null; keys: string[] }

/** The release's message, naming the snippets it changed. */
export let saying = (keys: string[]) =>
  `Saved on the page: ${keys.join(', ')} in ${COPY}`

/** The snippets and lists of `sent` that change `text`, a copy file. A file
 * that is not one is refused, naming why, since Save cannot say where a key
 * goes. */
export let changing = (text: string, sent: Record<string, Value>) => {
  let copy
  try {
    copy = parse(text)
  } catch (e) {
    throw refuse('arguments', (e as Error).message)
  }
  return Object.keys(sent).filter((key) => !same(valueAt(copy, key), sent[key]))
}

let text = (value: unknown) => typeof value == 'string'

/** Snippets as a request sends them: an object of key to its text, or to a
 * list's items' text. */
export let snippets = (value: unknown): Record<string, Value> => {
  let ok = value != null && typeof value == 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([key, sent]) =>
      key.trim() &&
      (text(sent) || Array.isArray(sent) && sent.every(text))
    )
  if (!ok || !Object.keys(value as object).length) {
    throw refuse(
      'arguments',
      'copy is an object of snippet key to its text, or a list of texts',
    )
  }
  return value as Record<string, Value>
}

let decoder = new TextDecoder()
let encoder = new TextEncoder()

let carried = (app: App, files: Files) =>
  app.worker === '' && !!app.declaration &&
  !Object.keys(files).some((p) =>
    p.startsWith(BUILT) || p == 'package.json' ||
    p == 'wrangler.json' || p == 'wrangler.jsonc' ||
    !app.seeded && seedy(p)
  )

let changedCopy = async (text: string, sent: Record<string, Value>) => {
  let next = set(text, sent)
  let [file] = await hashed([{ path: COPY, bytes: encoder.encode(next) }])
  return { next, file }
}

let roomFor = async (
  ctx: Ctx,
  space: Space,
  file: Awaited<ReturnType<typeof changedCopy>>['file'],
) => {
  let full = await fullAt(ctx.env, space, [file])
  if (full) throw refuse('space_full', full)
}

// A private unpublished app has no edge pages to purge. The app row's
// compare-and-swap replaces the release and records its history together.
// A concurrent release or save makes us read and merge against its result.
let savedPrivately = async (
  ctx: Ctx,
  space: Space,
  app: App,
  who: Who,
  store: Door,
  sent: Record<string, Value>,
): Promise<Saved | undefined> => {
  let raw = r2RawObjects(ctx.env.BLOBS)
  let c = ctx.clock ?? clock()
  for (;;) {
    let live = await waiting(ctx.dir, space, app, who)
    if (live.access != 'private' || live.published || !live.source) return
    let index = await atRelease(raw, live.source)
    if (!index) return
    let files = filesOf(index)
    if (!carried(live, files)) return
    let copy = index[COPY]
    let text = copy?.text ??
      (copy ? decoder.decode(await raw.get(copy.key)) : '')
    let keys = changing(text, sent)
    if (!keys.length) return { version: live.version ?? null, keys }
    let { file, next } = await changedCopy(text, sent)
    await roomFor(ctx, space, file)
    let source = releaseOf(space, live)
    let candidate = { ...live, source }
    let stage = staged(raw, { ...files, [COPY]: file.sha }, source)
    let [head, pinned] = await Promise.all([
      ctx.dir.deployHead(live),
      c.time('snapshot', () => stage.finish({}, live.source, { [COPY]: next })),
      raw.put(addressed(file.sha), file.bytes),
      declarationOf(ctx.env, space, live).then((words) =>
        keepDeclaration(ctx.env, space, candidate, live.declaration!, words)
      ),
    ])
    let version = head.newest + 1
    let message = saying(keys)
    try {
      await c.time(
        'record',
        () =>
          record(ctx.dir, who, candidate, version, pinned, '', {
            head,
            declaration: live.declaration!,
            sourceWas: live.source,
            accessWas: live.access,
            speaks: head.speaks,
            message,
          }),
      )
    } catch (error) {
      if (!overtaken(error, live)) throw error
      ctx.dir.reread()
      if (error instanceof Stale && error.prop == 'access') return
      continue
    }
    background(releaseNotice(store, version, {
      request: 'POST /api/save',
      space: space.slug,
      app: app.slug,
    }))
    background(
      releaseUpdate(ctx, space, live, who, message).catch((error) =>
        caught(error, {
          request: 'save update',
          space: space.slug,
          app: app.slug,
        })
      ),
    )
    return { version, keys }
  }
}

/** `sent` set in the app's live copy.json and released. */
export let saved = async (
  ctx: Ctx,
  space: Space,
  app: App,
  who: Who,
  store: Door,
  sent: Record<string, Value>,
): Promise<Saved> => {
  if (app.access == 'private' && !app.published) {
    let quick = await savedPrivately(ctx, space, app, who, store, sent)
    if (quick) return quick
  }
  let raw = r2RawObjects(ctx.env.BLOBS)
  let textOf = async (live: Files) =>
    live[COPY] ? decoder.decode(await raw.get(addressed(live[COPY]))) : ''
  // What changes is said before the fence is taken, so a save sent again
  // after its answer was lost releases nothing twice. The fence then holds
  // the live files still while the snippets are set in them.
  let keys = changing(await textOf(await served(raw, app)), sent)
  if (!keys.length) return { version: app.version ?? null, keys }
  let { version } = await released(ctx, space, app, who, store, {
    message: saying(keys),
    over: async (live) => {
      let { file } = await changedCopy(await textOf(live), sent)
      await roomFor(ctx, space, file)
      await raw.put(addressed(file.sha), file.bytes)
      return { ...live, [COPY]: file.sha }
    },
  })
  return { version, keys }
}

/** The release `version` made, taken back to the one it replaced, while it
 * is still live. Answers the version live now. */
export let undone = async (
  ctx: Ctx,
  space: Space,
  app: App,
  who: Who,
  store: Door,
  version: unknown,
): Promise<{ version: number }> => {
  if (!Number.isSafeInteger(version)) {
    throw refuse('arguments', 'version is the version Save released')
  }
  if (app.version != version) {
    throw refuse('stale', `v${version} is no longer live`)
  }
  let all = await versions(ctx.dir, app)
  let live = all.find((v) => v.version == version)
  let want = live && deployedOver(all, await ctx.dir.switches(app), live)
  if (!want) {
    throw refuse('missing', `v${version} replaced no version to go back to`)
  }
  let back = await released(ctx, space, app, who, store, {
    target: want,
    expectedVersion: version as number,
    keep: true,
  })
  return { version: back.version }
}
