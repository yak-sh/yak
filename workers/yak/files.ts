// The cached half of serving an app's file (T-33197): bytes out of R2, and
// nothing else. This part knows an app's eid, the R2 prefix its files live
// under, and a path. It does NOT know who is asking, and that is the whole
// point — Cloudflare's cache sits in front of this entrypoint (cache.ts), so
// anything this part could learn about a person would end up shared with
// strangers.
//
// The access decision stays in apps.ts `served()`, in front, on the uncached
// gateway, run on every single request. What is cached here is the same for
// everyone who is allowed to see it at all, so a private app's file is as
// cacheable as a public one: the cache holds the bytes, and the gateway holds
// the question of who may have them.
//
// Reachable only through the `FILES` service binding (wrangler.toml), which is
// bound to this named entrypoint. The routes in wrangler.toml address the
// default entrypoint, so no request from the internet arrives here — a caller
// has to be this Worker.
import { r2Blobs } from '../../src/blobs_r2.ts'
import { keepable, tagsOf } from './cache.ts'
import type { Env } from './env.ts'
import { sha256 } from './versions.ts'

// What the gateway tells this part, in headers rather than the path, because
// the PATH is the cache key and these two are not part of what distinguishes
// one answer from another. The prefix moves when an app's slug moves
// (tools.ts `app_set` copies the bytes across), and the same bytes at the new
// prefix are the same answer — so keying on it would throw away a warm cache
// for a rename that changed nothing a visitor sees.
export let PREFIX = 'x-yak-prefix'

// The bytes' own name, handed back so the gateway can build an ETag without
// hashing the body on every request. It is cached along with the bytes, so a
// hit costs no hash at all.
export let SHA = 'x-yak-sha'

let MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
  pdf: 'application/pdf',
}

export let mimeOf = (path: string) =>
  MIME[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream'

// A file's key in the blob store: the app's prefix then its path, a directory
// answering with its index. Decoded, so the key is the name the file was put
// under; a malformed escape throws, and the router reports it.
export let keyed = (prefix: string, path: string) =>
  `${prefix}${
    decodeURIComponent(path.endsWith('/') ? `${path}index.html` : path)
  }`

// The prefix an app's files live under, which is its address and therefore
// moves when its slug does.
export let prefixOf = (space: { slug: string }, app: { slug: string }) =>
  `${space.slug}/${app.slug}`

// A path behind no file whose last segment names no file TYPE is a route, not
// a miss (T-32769): `/recipes/42` is the page asking to be opened at a place,
// so the app's own index.html answers it. Anything with an extension is a file
// that is not there — a missing stylesheet must never answer HTML.
let pretty = (path: string) => !path.split('/').pop()!.includes('.')

// The 404 is cached too, and wears the same tag, so the write that finally
// creates the file is the thing that clears it. Without that, a page that
// asked for a file before it existed would be told it does not exist for as
// long as the cache held the answer.
let missing = (keep: Record<string, string>) =>
  new Response('not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...keep },
  })

// The inner door. The gateway has already decided this request may be served;
// everything here is about which bytes.
//
// The tag is derived from the SAME path segment the cache key is made of, so
// the entry and the tag that purges it cannot disagree — the thing a purge
// must reach and the thing it names come from one read of one string.
export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  // `/<app eid>/<the app's own path>` (cache.ts `at`): the eid is the cache
  // key's tenant discriminator and is not part of the file's name.
  let eid = url.pathname.slice(1).split('/')[0] ?? ''
  let path = url.pathname.replace(/^\/[^/]+/, '') || '/'
  let keep = keepable(tagsOf(eid))
  let prefix = req.headers.get(PREFIX)
  if (!prefix || !eid) return missing(keep)
  let blobs = r2Blobs(env.BLOBS)
  // ONE read, not a stat and then a read (T-33176): the bucket is a round trip
  // away, and asking whether the file is there before asking for it paid that
  // trip twice for every file the app serves.
  let key = keyed(prefix, path)
  let bytes = await blobs.read(key)
  if (!bytes && pretty(path)) {
    key = keyed(prefix, '/')
    bytes = await blobs.read(key)
  }
  if (!bytes) return missing(keep)
  return new Response(bytes, {
    headers: {
      'content-type': mimeOf(key),
      [SHA]: (await sha256(bytes)).slice(0, 24),
      ...keep,
    },
  })
}
