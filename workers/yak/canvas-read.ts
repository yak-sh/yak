// What an app beside the chat is made of (@yaks/platform/app-canvas
// `appMaking`), as the page graph's door reads it for the person (reach-door.ts):
// what its draft declares and the pages it holds, read from the draft as it
// stands (written.ts `drafting`), its workflow in its live store, and its
// draft's preview link. No store holds this, so it is read whole, and read
// again whenever what it is read from moves: where its drafts stand, which
// the directory answers as a read of the person (@yaks/platform/app-canvas
// `appDrafted`), and its builders and their edges in its own store.
import type { Bundle } from '@yaks/graph'
import { type Built, line } from '@yaks/query'
import { workflow } from '@yaks/builders/workflow'
import { appDrafted, type Making, makingRow } from '@yaks/platform/app-canvas'
import { madeOf, pagesOf } from '@yaks/platform/app-made'
import { VOCABS } from '@yaks/platform/manifest'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { CallError } from '@yaks/tools/errors'
import type { Kept } from '@yaks/api/reached'
import type { Frame } from '@yaks/reach'
import { caught } from './defects.ts'
import type { Directory, Space } from './directory.ts'
import { storeOf } from './door.ts'
import type { Env } from './env.ts'
import { r2RawObjects } from './lib/objects.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import { linkOf } from './preview.ts'
import { watching } from './reach.ts'
import { vouched, type Who } from './session.ts'
import { inApp } from './tool.ts'
import { drafting, draftsOf, theirs } from './written.ts'

type Found = NonNullable<Awaited<ReturnType<typeof inApp>>>

// The app `eid` as `who` may open it with the tools' own access (tool.ts
// `inApp`); null for one they may not open, or one gone.
let opened = async (
  env: Env,
  dir: Directory,
  who: Who,
  eid: string,
): Promise<{ space: Space; found: Found } | null> => {
  let at = await dir.appAt(eid)
  if (!at) return null
  let ctx = { env, dir, person: who.person ?? '' }
  let found = await inApp(ctx, { space: at.space.slug, app: at.app.slug }, true)
    .catch((e) => e instanceof CallError ? null : Promise.reject(e))
  return found ? { space: at.space, found } : null
}

// The workflow the app's live store holds: its builders and the `requires`
// edges between them, as the person may read them. A store that cannot be
// read draws no steps, and the failure is reported.
let stepsOf = async (found: Found, space: Space) => {
  let read = (q: Built) =>
    metaOf(found.store, { ...vouched(found.who), 'x-yak-observe': '1' })
      .query(q)
  try {
    let [builders, edges] = await Promise.all([
      read(line`.builder&*`),
      read(line`.requires&*`),
    ])
    return workflow([...builders, ...edges])
  } catch (error) {
    caught(error, {
      request: 'app workflow',
      space: space.slug,
      app: found.app.slug,
    })
    return []
  }
}

// What the app is made of, from the draft the person and their Operator
// write in (written.ts `theirs`).
let makingOf = async (
  env: Env,
  dir: Directory,
  space: Space,
  found: Found,
): Promise<Making> => {
  let { app } = found
  let draft = await drafting(
    r2RawObjects(env.BLOBS),
    dir,
    app,
    theirs(await draftsOf(dir, app), found.who),
  )
  let decoded = (bytes: Uint8Array | null) =>
    bytes ? new TextDecoder().decode(bytes) : ''
  let file = VOCABS.find((p) => p in draft.files)
  let words = file ? await draft.view.read(`${draft.root}/${file}`) : null
  let pages = pagesOf(
    await Promise.all(
      Object.keys(draft.files).filter((p) => p.endsWith('.html')).map(
        async (p) =>
          [p, decoded(await draft.view.read(`${draft.root}/${p}`))] as [
            string,
            string,
          ],
      ),
    ),
  )
  let pending = !!pages.length && draft.unreleased && !!env.SESSION_SECRET
  let ctx = { env, dir, person: found.who.person ?? '' }
  return {
    made: madeOf(words && decoded(words), file),
    pages,
    steps: await stepsOf(found, space),
    draft: pending && draft.of
      ? (await linkOf(ctx, space, app, found.who, draft.of)).at
      : null,
  }
}

/** The app `eid` being made, as `who` may see it: its row, or none for an app
 * they may not open, or one gone. */
export let making = async (
  env: Env,
  dir: Directory,
  who: Who,
  eid: string,
): Promise<Bundle[]> => {
  let open = await opened(env, dir, who, eid)
  if (!open) return []
  let now = await makingOf(env, dir, open.space, open.found)
  return [makingRow(who.person!, eid, now)]
}

/** The app `eid` being made, live: `sink` hears its row now and each time
 * what it is read from moves, each frame the whole answer, until what this
 * returns is called. One read runs at a time, and moves while it runs are
 * read once after it. */
export let watchMaking = (
  env: Env,
  dir: Directory,
  who: Who,
  eid: string,
  sink: (frame: Kept) => void,
): () => void => {
  let closed = false, reading = false, again = false
  let stops: (() => void)[] = []
  let read = async () => {
    if (reading) return void (again = true)
    reading = true
    try {
      do {
        again = false
        let bundles = await making(env, dir, who, eid)
        if (!closed) sink({ bundles, reset: true })
      } while (again && !closed)
    } catch (error) {
      if (!closed) sink({ refused: error })
    } finally {
      reading = false
    }
  }
  // A store's first answer is what was read already; each after it moves.
  let moved = () => {
    let first = true
    return (frame: Frame) => {
      if (first || !frame.bundles) return void (first = false)
      read()
    }
  }
  opened(env, dir, who, eid).then((open) => {
    if (closed) return
    if (!open) return sink({ bundles: [], reset: true })
    let { app, store } = open.found
    stops.push(
      watching(
        meta(env).door ?? storeOf(env.STORE, PLATFORM_STORE),
        'directory',
        appDrafted(eid),
        moved(),
        { ...vouched(who), ...KERNEL },
        '/person/ws',
      ),
      watching(
        store,
        app.slug,
        '.builder | .requires',
        moved(),
        { ...vouched(open.found.who), 'x-yak-observe': '1' },
      ),
    )
    read()
  }, (error) => closed || sink({ refused: error }))
  return () => {
    closed = true
    for (let stop of stops) stop()
  }
}
