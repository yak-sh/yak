// Public files (D-132641): an app publishes a file at a path of its own
// address, and from then on that address answers those bytes to anyone,
// before the app's worker runs and whatever the app's access says. A private
// blog editor publishes its posts at the paths it picks; a private notebook
// publishes one page at a fresh UUID path, a link only the people given it
// know. The platform holds the whole permission, so nobody writes auth code to
// publish.
//
// A published file is a static site's file written while the app runs: one
// `public_file{app, path, sha, mime, size}` row in the directory per address,
// its eid derived from the app and the path, and its bytes under the app's
// own prefix, where they count against the space's files, move with a rename
// and go with an erase, as uploads do. No release holds one, so a deploy or a
// rollback never moves it. An app wears `publishing` from its first publish,
// and only such an app's requests look for one (apps.ts `served`).
//
// The door is the app's own `/api/public`, and publishing is a member's act,
// as writing the app's files is (apps.ts decides who):
//
//   PUT    public/<path>   publish these bytes at <path>, or replace them
//   POST   public          publish at a new UUID path
//   DELETE public/<path>   unpublish
//   GET    public          every file the app published
//
// Each answers `{path, url, sha, mime, size}`, `url` being where the file
// answers for the address the request came in on.
import { mimeOf } from '@yaks/blob'
import { identityEid } from '@yaks/graph/identity'
import { caught } from './defects.ts'
import type { App, Directory, PublicFile, Space } from './directory.ts'
import type { Env } from './env.ts'
import { blobBytes } from './files.ts'
import { r2Objects } from './lib/objects.ts'
import { appTag, purge } from './purge.ts'
import { fullFiles } from './usage.ts'
import { sha256 } from './versions.ts'

// The largest file one request publishes: Cloudflare's own limit on a static
// asset, which is what a published file is.
export let MOST = 25 * 1024 * 1024

let SEGMENT = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/

/// publicPath('posts/hello') -> 'posts/hello'
/// publicPath('posts/hello/index.html') -> 'posts/hello/index.html'
/// publicPath('3f2a9c1e-0b5d-4e7a-9c2f-1a2b3c4d5e6f') -> '3f2a9c1e-0b5d-4e7a-9c2f-1a2b3c4d5e6f'
/// publicPath('/posts/hello') -> null
/// publicPath('posts/hello/') -> null
/// publicPath('posts/../secret') -> null
/// publicPath('.well-known/x') -> null
/// publicPath('api/query') -> null
/// publicPath('_web/x') -> null
/// publicPath('~token/x') -> null
/// publicPath('index.html') -> null
/// publicPath('a,b') -> null
/** A path an app may publish at, as it is kept, or null. It is from the app's
 * root with no leading or trailing `/`, made of segments of letters, digits,
 * `-`, `_` and single dots. Never under the app's own doors (`api/`), the
 * platform's (`_…`), or a page token (`~…`), and never the app's front page,
 * which would answer before the app for its own members too. */
export let publicPath = (path: string): string | null => {
  if (!path || path.length > 512 || path == 'index.html') return null
  let segments = path.split('/')
  if (!segments.every((s) => SEGMENT.test(s))) return null
  if (segments[0] == 'api' || segments[0].startsWith('_')) return null
  return path
}

/// askedFor('/posts/hello') -> 'posts/hello'
/// askedFor('/posts/hello/') -> 'posts/hello/index.html'
/// askedFor('/') -> null
/// askedFor('/%7Etoken/x') -> null
/** The published path a request path names, or null: the path itself, or its
 * folder's `index.html` for one asked with its slash, as a file is served. */
export let askedFor = (path: string): string | null => {
  let at = decoded(path.replace(/^\//, ''))
  if (at == null) return null
  return publicPath(at.endsWith('/') ? `${at}index.html` : at)
}

let decoded = (path: string) => {
  try {
    return decodeURIComponent(path)
  } catch {
    return null
  }
}

/** Where an app's published bytes live: beside its uploads, under its own
 * prefix, so they are the space's and follow the app. */
export let publicPrefix = (
  space: Pick<Space, 'store'>,
  app: Pick<App, 'slug'>,
) => `${space.store}/${app.slug}/public/`

/// typeOf('text/html; charset=utf-8', 'x') -> 'text/html; charset=utf-8'
/// typeOf('', 'notes/week-1.html') -> 'text/html; charset=utf-8'
/// typeOf('application/octet-stream', 'cover.png') -> 'image/png'
/// typeOf('not a type', 'x') -> 'application/octet-stream'
/** The type a published file is served as: the one its page sent, or the one
 * its path says. */
export let typeOf = (sent: string, path: string) => {
  let said = sent.trim().slice(0, 120)
  let bare = said.split(';')[0].trim().toLowerCase()
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(bare) &&
      bare != 'application/octet-stream'
    ? said
    : mimeOf(path)
}

/** The eid of the file an app published at a path: one row per address. */
export let publicEid = (app: Pick<App, 'eid'>, path: string) =>
  identityEid('public_file', [app.eid, path])

type Ask = {
  req: Request
  env: Env
  dir: Directory
  space: Space
  app: App
  // Where the app is mounted for this request (`/<app>/`, or `/` at a front
  // page or a custom domain), which a file's `url` is under.
  at: string
}

let said = (file: PublicFile, ask: Ask) => ({
  path: file.path,
  url: new URL(ask.at + file.path, ask.req.url).href,
  sha: file.sha,
  mime: file.mime,
  size: file.size,
})

let no = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

/** The `/api/public` door, for someone apps.ts has let publish. `rest` is the
 * request path after `/api/public`. */
export let door = async (ask: Ask, rest: string): Promise<Response> => {
  let { req } = ask
  if (!rest || rest == '/') {
    if (req.method == 'GET') {
      let files = await ask.dir.publicFiles(ask.app)
      return Response.json(files.map((f) => said(f, ask)))
    }
    if (req.method == 'POST') return await published(ask, crypto.randomUUID())
    return no(405, 'method_not_allowed', 'GET or POST public, or PUT a path')
  }
  let path = decoded(rest.slice(1))
  let kept = path == null ? null : publicPath(path)
  if (!kept) {
    return no(
      400,
      'invalid_path',
      'a published path is segments of letters, digits, - _ and single dots, ' +
        'not under api/ or _, and not the front page index.html',
    )
  }
  if (req.method == 'PUT') return await published(ask, kept)
  if (req.method == 'DELETE') return await unpublished(ask, kept)
  return no(405, 'method_not_allowed', 'PUT or DELETE a published path')
}

let published = async (ask: Ask, path: string) => {
  let { req, env, dir, space, app } = ask
  if (Number(req.headers.get('content-length') ?? 0) > MOST) {
    await req.body?.cancel()
    return no(413, 'too_large', 'a published file is 25 MiB at most')
  }
  let bytes = new Uint8Array(await req.arrayBuffer())
  if (!bytes.byteLength) return no(400, 'no_bytes', 'nothing was sent')
  if (bytes.byteLength > MOST) {
    return no(413, 'too_large', 'a published file is 25 MiB at most')
  }
  let sha = await sha256(bytes)
  let key = publicPrefix(space, app) + sha
  let stopped = await fullFiles(env, space, [{ key, bytes: bytes.byteLength }])
  if (stopped) return no(413, 'space_full', stopped)
  let blobs = r2Objects(env.BLOBS)
  if (!(await blobs.has(key))) await blobs.put(key, bytes)
  let was = await dir.publicFile(app, path)
  let file = {
    app: app.eid,
    path,
    sha,
    mime: typeOf(req.headers.get('content-type') ?? '', path),
    size: bytes.byteLength,
  }
  // The row's write purges the app's kept pages (facets/pages-graph.ts).
  await dir.stamp({
    entities: [
      { entity: { eid: publicEid(app, path) }, public_file: file },
      ...(app.publishing ? [] : [{ entity: { eid: app.eid }, publishing: {} }]),
    ],
  })
  if (was && was.sha != sha) await released(ask, was.sha)
  return Response.json(said({ eid: publicEid(app, path), ...file }, ask))
}

let unpublished = async (ask: Ask, path: string) => {
  let { env, dir, space, app } = ask
  let was = await dir.publicFile(app, path)
  if (!was) return no(404, 'no_such_file', `nothing is published at ${path}`)
  await dir.stamp({ entities: [{ entity: { eid: was.eid }, $delete: true }] })
  // A deleted row names no app, so the directory's hook cannot purge for it.
  await purge(env, [appTag(app.eid)]).catch((e) =>
    caught(e, { request: 'unpublish purge', space: space.slug, app: app.slug })
  )
  await released(ask, was.sha)
  return Response.json(said(was, ask))
}

// Bytes no published file of the app names any more go.
let released = async ({ env, dir, space, app }: Ask, sha: string) => {
  if ((await dir.publicFiles(app)).some((f) => f.sha == sha)) return
  await r2Objects(env.BLOBS).delete(publicPrefix(space, app) + sha)
}

/** The file an app published at the path a request asks for, as served to
 * anyone, or null where none is: the app's own turn. `path` is the request's
 * path within the app. HTML comes back unwoven; apps.ts weaves it as it does
 * a worker's page. */
export let served = async (ask: Ask, path: string) => {
  let { req, env, dir, space, app } = ask
  if (!app.publishing || (req.method != 'GET' && req.method != 'HEAD')) {
    return null
  }
  let at = askedFor(path)
  if (!at) return null
  let file = await dir.publicFile(app, at)
  if (!file) return null
  let bytes = await blobBytes(
    env,
    app,
    publicPrefix(space, app),
    file.sha,
    req.headers.get('range'),
    req.method,
  )
  if (bytes.status == 404) {
    await bytes.body?.cancel()
    caught(new Error(`published ${at} has no bytes at ${file.sha}`), {
      request: 'GET public file',
      space: space.slug,
      app: app.slug,
    })
    return null
  }
  let headers = new Headers(bytes.headers)
  headers.set('content-type', file.mime)
  headers.set('cache-control', 'public, no-cache')
  headers.set('etag', `"${file.sha}"`)
  headers.set('x-content-type-options', 'nosniff')
  return new Response(bytes.body, { status: bytes.status, headers })
}
