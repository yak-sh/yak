// Save in edit mode (edit-mode.ts): the snippets a member drafted on an app's
// page, set in its copy.json (@yaks/copy) and released. It is a release like
// any other, made the one way (tools.ts `released`), so app_versions lists it
// and app_rollback takes it back. It releases only the copy: the live files
// with copy.json replaced, read while the release's fence holds them, so two
// people saving different snippets each change what the other released. The
// app's draft, anybody's unreleased edits, stays a draft.
//
// Undo is app_rollback's path: the release Save made goes back to the one it
// replaced, while it is still the live one.
import { parse, read, set } from '@yaks/copy'
import type { Door } from '@yaks/durable-object/door'
import type { App, Space } from './directory.ts'
import { r2RawObjects } from './lib/objects.ts'
import { COPY } from './page-copy.ts'
import type { Who } from './session.ts'
import { type Ctx, refuse } from './tool.ts'
import { fullAt, hashed, released } from './tools.ts'
import { addressed, deployedOver, type Files, versions } from './versions.ts'
import { served } from './written.ts'

/** What a save answers: the version it released, or the live one where
 * nothing it was sent differed, and the keys it changed. */
export type Saved = { version: number | null; keys: string[] }

/** The release's message, naming the snippets it changed. */
export let saying = (keys: string[]) =>
  `Saved on the page: ${keys.join(', ')} in ${COPY}`

/** The snippets of `sent` that change `text`, a copy file. A file that is
 * not one is refused, naming why, since Save cannot say where a key goes. */
export let changing = (text: string, sent: Record<string, string>) => {
  let copy
  try {
    copy = parse(text)
  } catch (e) {
    throw refuse('arguments', (e as Error).message)
  }
  return Object.keys(sent).filter((key) => read(copy, key) != sent[key])
}

/** Snippets as a request sends them: an object of key to text. */
export let snippets = (value: unknown): Record<string, string> => {
  let ok = value != null && typeof value == 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([key, text]) =>
      key.trim() && typeof text == 'string'
    )
  if (!ok || !Object.keys(value as object).length) {
    throw refuse('arguments', 'copy is an object of snippet key to its text')
  }
  return value as Record<string, string>
}

let decoder = new TextDecoder()
let encoder = new TextEncoder()

/** `sent` set in the app's live copy.json and released. */
export let saved = async (
  ctx: Ctx,
  space: Space,
  app: App,
  who: Who,
  store: Door,
  sent: Record<string, string>,
): Promise<Saved> => {
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
      let [file] = await hashed([{
        path: COPY,
        bytes: encoder.encode(set(await textOf(live), sent)),
      }])
      let full = await fullAt(ctx.env, space, [file])
      if (full) throw refuse('space_full', full)
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
