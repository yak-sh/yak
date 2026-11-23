// An app's uploads on yaks.app: @yaks/blob's write half (@yaks/blob/upload)
// and its door (@yaks/blob/routes), in the app's words
// (@yaks/platform/uploads), over what only the Worker knows. That is where in
// the bucket the app keeps its bytes, the room its space has, what the
// release serving the app takes, whom its rows are written as, and Files'
// cache of what it serves. Bytes arrive by many doors (`blobDoor`, a page's
// `./api/blob`; inbox.ts, a letter's attachments; library-tools.ts, a fetched
// document), and each keeps them through here.

import { type Line } from '@yaks/query'
import type { Bundle, Comp } from '@yaks/graph'
import type { Read } from '@yaks/blob/upload'
import { type Accepts, prefixed, type Put } from '@yaks/blob'
import {
  type File as Filed,
  filed as kept,
  servable,
  type Upload,
} from '@yaks/blob/upload'
import { routes } from '@yaks/blob/routes'
import type { Refusal } from '@yaks/api'
import { routed } from '@yaks/api/routed'
import type { Door } from '@yaks/durable-object/door'
import { Denied, mode, stands } from '@yaks/member'
import { uploadFloor } from '@yaks/platform/app-authority'
import { sandboxed } from '@yaks/platform/installs'
import { json } from '@yaks/platform/refused'
import { uploads } from '@yaks/platform/uploads'
import { blobPrefix, uploadPrefix } from './blob-key.ts'
import { declarationOf } from './declaration.ts'
import { type App, type Space, storeAt } from './directory.ts'
import type { Env } from './env.ts'
import * as files from './files.ts'
import { r2Objects } from './lib/objects.ts'
import { KERNEL, type Meta, metaOf } from './meta.ts'
import type { Who } from './session.ts'
import { fullFiles } from './usage.ts'
import { Pending } from '@yaks/api/log'

// Where an app's uploaded bytes live: the prefix its row was born with
// (blob-key.ts `blobPrefix`), which no rename moves and erasing the app
// empties only after a person confirms permanent erasure (erase.ts `emptied`).
// Deleting an upload's content row keeps its bytes available for restoration.
export let blobKey = (space: Space, app: App, sha: string) =>
  blobPrefix(space, app) + sha

/** What the app takes as a blob, from the release serving it. */
export let acceptsOf = async (env: Env, space: Space, app: App) =>
  (await declarationOf(env, space, app)).vocab.blob as Accepts | undefined

/** Where the app's uploads are kept: its prefix in the bucket, counted as
 * every trip to it is (lib/objects.ts), in its own scope and words, held to
 * the room its space has. The bucket takes whatever Cloudflare lets through,
 * so it sets no limit of its own. */
export let keptAt = (env: Env, space: Space, app: App): Upload => {
  let prefix = blobPrefix(space, app)
  return {
    store: prefixed(r2Objects(env.BLOBS), prefix),
    scope: app.eid,
    limit: Infinity,
    // Bytes the app already holds count nothing (usage.ts `fullFiles`).
    room: (sha, bytes) => fullFiles(env, space, [{ key: prefix + sha, bytes }]),
    naming: uploads,
  }
}

/** {@link keptAt}, and what the app takes: `accepts`, else its release's. */
export let uploadOf = async (
  env: Env,
  space: Space,
  app: App,
  accepts?: Accepts,
): Promise<Upload> => ({
  ...keptAt(env, space, app),
  accepts: accepts ?? await acceptsOf(env, space, app),
})

/** Kept bytes, the rows that name them, and where the app serves them. */
export type File = Filed & { url: string }

// A store as the write half reads it.
let reading = (graph: Pick<Meta, 'query'>): Read => (said) =>
  graph.query(said as Line)

/**
 * Bytes into the app's bucket, and the rows that name them there — the
 * write half of an upload, without a request anywhere in it, because bytes
 * arrive by other doors too (inbox.ts: a letter's attachments). Bytes the app
 * does not take (`accepts`), or a space with no room, throw @yaks/blob/upload
 * `Untaken` before any are kept. The caller applies the bundles, as whoever
 * it decided is writing.
 */
export let filed = async (
  env: Env,
  space: Space,
  app: App,
  graph: Pick<Meta, 'query'>,
  bytes: Put,
  mime: string,
  name: string,
  accepts?: Accepts,
): Promise<File> => {
  let file = await kept(
    reading(graph),
    await uploadOf(env, space, app, accepts),
    bytes,
    mime,
    name,
  )
  return { ...file, url: `/${app.slug}/api/blob/${file.path}` }
}

/** Whether `who` is below the app's upload floor (app-authority.ts
 * `uploadFloor`): the refusal they are given before any bytes are kept, as the
 * store's guard holds the rows that name them, or nothing. */
export let belowFloor = async (
  env: Env,
  space: Space,
  app: App,
  who: Pick<Who, 'person' | 'role'>,
) => {
  let need = uploadFloor((await declarationOf(env, space, app)).vocab)
  return need && !stands(who.person, who.role, need)
    ? new Denied(who.person, app.eid, need, 'write', 'attachment')
    : undefined
}

/**
 * One whole upload, as whoever `graph` writes as: the bytes kept and the rows
 * that name them applied, so the app's rules (extraction among them) run on
 * it. What the connector's library tools do with a document they fetched or
 * were handed (library-tools.ts). Bytes the app does not take, or a space
 * with no room, throw `Untaken`; a store's refusal of the rows throws as it
 * answered. A write the store's log keeps (`Pending`) lands when the app
 * recovers, so it is no failure here. `source` is the web address the file
 * came from.
 */
export let uploaded = async (
  env: Env,
  space: Space,
  app: App,
  graph: Meta,
  bytes: Put,
  o: {
    mime: string
    name: string
    source?: string
    accepts?: Accepts
    protect?: (rows: Bundle[], sha: string, size: number) => Bundle[]
  },
): Promise<File> => {
  let file = await filed(
    env,
    space,
    app,
    graph,
    bytes,
    o.mime,
    o.name,
    o.accepts,
  )
  if (o.source) {
    file.bundles = file.bundles.map((b) =>
      b.attachment
        ? { ...b, attachment: { ...b.attachment as Comp, source: o.source } }
        : b
    )
  }
  if (o.protect) file.bundles = o.protect(file.bundles, file.sha, file.bytes)
  try {
    await graph.apply(file.bundles, KERNEL)
  } catch (e) {
    // Kept by the store's write log (@yaks/api/log): the bytes are stored and their
    // row lands when the app recovers, so the upload is not told it failed.
    if (!(e instanceof Pending)) throw e
  }
  return file
}

/** Whether the bytes are served at all, which is the store's to say
 * (@yaks/blob/upload `servable`). For an app anyone may read, Files keeps a
 * yes (files.ts `servedAs`), so a burst of image reads is not a burst of
 * store reads; a no from it, and every read of a private or sandboxed app's,
 * is asked here as the reader. A store that could not say throws. */
export let servedTo = async (
  env: Env,
  space: Space,
  app: App,
  graph: Pick<Meta, 'query'>,
  sha: string,
  eid: string,
  cache?: RequestCache,
) => {
  let read = () =>
    servable(reading(graph), { scope: app.eid, naming: uploads }, sha, eid)
  return !sandboxed(app) && mode(app.access) != 'private'
    ? await files.servableOf(
      env,
      app,
      storeAt(space, app, env),
      sha,
      eid,
      cache,
    ) ??
      await read()
    : await read()
}

// A refusal of the door's (@yaks/api `Refusal`, with the door's `code` for
// it), in the page's envelope as the gateway's own are:
// `{error: {code, message}}` (@yaks/platform/refused), with its status and
// the wait it asks for.
let enveloped = async (answer: Response) => {
  if (answer.ok || answer.status == 302 || answer.status == 304) return answer
  if (!answer.headers.get('content-type')?.includes('json')) return answer
  let said: Refusal & { code?: string } = await answer.json()
  let out = Response.json({
    error: {
      code: said.code ?? 'refused',
      message: said.message ?? said.code,
      ...said.error ? { name: said.error } : {},
    },
  }, { status: answer.status })
  let wait = answer.headers.get('retry-after')
  if (wait) out.headers.set('retry-after', wait)
  return out
}

/**
 * A page's file door, `./api/blob` (@yaks/blob/routes), once the gateway has
 * asked who may read and write: its rows read as `reader` and written as
 * `writer`, which is asked only when there are rows to write. `path` is the
 * request's own below the app's `./api`, so the door answers where the page
 * asked it, whatever mount that came through.
 */
export let blobDoor = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  store: Door,
  path: string,
  as: {
    reader: Record<string, string>
    writer: () => Promise<Record<string, string>>
  },
) => {
  let url = new URL(req.url)
  let at = `${url.pathname.slice(0, url.pathname.length - path.length)}/blob/`
  let reader = metaOf(store, as.reader)
  let writing = req.method == 'POST' || req.method == 'PUT'
  let { store: artifacts, ...taken } = keptAt(env, space, app)
  let prefix = blobPrefix(space, app)
  let objects = r2Objects(env.BLOBS)
  let door = routes({
    artifacts,
    graph: {
      read: reading(reader),
      // Who may write was asked at the gateway (apps.ts: the app's access and
      // its upload floor), and the store's guard holds the rows themselves,
      // so a check has nothing left to ask before the bytes are kept.
      apply: async (bundles, o) =>
        o.check
          ? bundles
          : await (writing ? metaOf(store, await as.writer()) : reader)
            .apply(bundles, KERNEL),
    },
  }, {
    ...taken,
    // Only an upload is held to what the app takes.
    accepts: writing ? await acceptsOf(env, space, app) : undefined,
    at,
    parts: { objects, bucket: env.BLOBS, prefix, ledger: uploadPrefix(prefix) },
    served: (sha, eid) =>
      servedTo(env, space, app, reader, sha, eid, req.cache),
    bytes: (seek, sha) =>
      files.blobBytes(
        env,
        app,
        prefix,
        sha,
        seek.headers.get('range'),
        seek.method,
      ),
    tags: { space: space.slug, app: app.slug },
  })
  let route = door.find((r) => routed(r, req.method, url.pathname))
  return route
    ? await enveloped(await route.handle(req))
    : json(404, 'no_such_file')
}
