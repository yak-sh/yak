// The cached half of serving an app's file (T-33197): bytes out of R2, and
// nothing else. This part knows an app's eid, the R2 prefix its files live
// under, and a path. It does not know who is asking, and that is the whole
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
import { r2Objects } from './lib/objects.ts'
import { mimeOf, type Objects, rangedOpen } from '@yaks/blob'
import { keepable, purge, tagsOf } from './cache.ts'
import type { App } from './directory.ts'
import { bound, type Env } from './env.ts'
import { BUILT } from './versions.ts'
import { parse, WORKER } from './wrangler_app.ts'

// What the gateway tells this part, in headers rather than the path, because
// the path is the cache key and these two are not part of what distinguishes
// one answer from another. The prefix moves when an app's slug moves
// (tools.ts `app_set` copies the bytes across), and the same bytes at the new
// prefix are the same answer — so keying on it would throw away a warm cache
// for a rename that changed nothing a visitor sees.
export let PREFIX = 'x-yak-prefix'

// The bytes' version, handed back so the gateway can build an ETag without
// hashing a response body. A release index carries its SHA; older files use
// the object store's ETag. The full and partial doors use the same version.
export let VERSION = 'x-yak-version'

export { mimeOf } from '@yaks/blob'

// A file's key in the blob store: the app's prefix then its path, a directory
// answering with its index. Decoded, so the key is the name the file was put
// under; a malformed escape throws, and the router reports it.
export let keyed = (prefix: string, path: string) =>
  `${prefix}${
    decodeURIComponent(path.endsWith('/') ? `${path}index.html` : path)
  }`

// The prefix an app's files live under, which is its address and therefore
// moves when its slug does.
export let prefixOf = (
  space: { slug: string },
  app: { slug: string; source?: string | null },
) => app.source ?? `${space.slug}/${app.slug}`

// A path behind no file whose last segment names no file type is a route, not
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

// The app-relative path of its server source: `main` out of either wrangler
// file, `worker.js` where it names none. Both files are asked for at
// once — an app carries at most one, so the miss is unavoidable and paying for
// it twice over is not.
let mainOf = async (blobs: Objects, prefix: string) => {
  let [jsonc, json] = await Promise.all([
    blobs.read(`${prefix}/wrangler.jsonc`),
    blobs.read(`${prefix}/wrangler.json`),
  ])
  let config = jsonc ?? json
  if (!config) return WORKER
  return parse(new TextDecoder().decode(config)).config.main ?? WORKER
}

// The address the purge door answers at. A POST, so it can never be confused
// with a file: only GET and head are cached, so this request runs the
// entrypoint every time — which is exactly what a purge needs, since the purge
// must be issued from in here (cache.ts).
let PURGE = '/purge'

// The purge a door calls when it has changed an app's bytes: one call empties
// every address this app answers at, at every edge. A door that changed only
// who may read does not call this and does not need to (cache.ts `tagsOf`).
//
// It goes through the binding rather than calling `purge()` directly because a
// purge only reaches the cache of the entrypoint that issues it, and every
// write door runs in the gateway. Without the binding — `wrangler dev`, the
// workerd probes — `bound` calls this module in-process, where there is no
// cache and the purge is a logged no-op.
export let purged = async (env: Env, app: App) => {
  let r = await bound(env.FILES, fetch, env).fetch(
    new Request(`https://files.invalid${PURGE}`, {
      method: 'POST',
      body: JSON.stringify(tagsOf(app.eid)),
    }),
  )
  await r.body?.cancel()
  return r.ok
}

// The inner door. The gateway has already decided this request may be served;
// everything here is about which bytes.
//
// The tag is derived from the same path segment the cache key is made of, so
// the entry and the tag that purges it cannot disagree — the thing a purge
// must reach and the thing it names come from one read of one string.
export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  if (req.method == 'POST' && url.pathname == PURGE) {
    let ok = await purge(await req.json() as string[])
    return new Response(null, { status: ok ? 204 : 500 })
  }
  // `/<app eid>/<the app's own path>` (cache.ts `at`): the eid is the cache
  // key's tenant discriminator and is not part of the file's name.
  let eid = url.pathname.slice(1).split('/')[0] ?? ''
  let path = url.pathname.replace(/^\/[^/]+/, '') || '/'
  let keep = keepable(tagsOf(eid))
  let prefix = req.headers.get(PREFIX)
  if (!prefix || !eid) return missing(keep)
  let blobs = r2Objects(env.BLOBS)
  // One read, not a stat and then a read (T-33176): the bucket is a round trip
  // away, and asking whether the file is there before asking for it paid that
  // trip twice for every file the app serves.
  let key = keyed(prefix, path)
  // Server source is not a public asset, even when `main` names a nested build
  // output. apps.ts `MANIFEST` already refuses the default `/worker.js` at the
  // gateway; this covers the configured path, which only the config names.
  // Started here and awaited after the file, so the lookup rides in the same
  // round trip as the bytes rather than in front of every script an app serves.
  let script = SCRIPT.test(key)
  let source = script ? mainOf(blobs, prefix) : null
  let type = mimeOf(key)
  let built = script ? keyed(prefix, `/${BUILT}${path.slice(1)}`) : null
  if (
    (req.method == 'HEAD' || req.headers.has('range')) &&
    !pretty(path) && !type.startsWith('text/html')
  ) {
    if (source && key == keyed(prefix, `/${await source}`)) {
      return missing(keep)
    }
    let compiled = built ? await blobs.open(built) : null
    let object = compiled ?? await blobs.open(key)
    if (!object) return missing(keep)
    return rangedOpen(object, req, {
      'content-type': compiled ? mimeOf('compiled.js') : type,
      [VERSION]: object.version,
      ...keep,
    })
  }
  // A page script the deploy compiled serves in its source's place, as
  // JavaScript whatever its extension (esbuild.ts): `<script type="module"
  // src="main.ts">` gets main.ts compiled. Asked for beside the source, in the
  // same round trip.
  let made = built ? blobs.load(built) : null
  let file = await blobs.load(key)
  if (source && key == keyed(prefix, `/${await source}`)) return missing(keep)
  let compiled = await made
  if (compiled) return served(compiled, mimeOf('compiled.js'), keep)
  if (!file && pretty(path)) {
    key = keyed(prefix, '/')
    file = await blobs.load(key)
  }
  if (!file) return missing(keep)
  return served(file, mimeOf(key), keep)
}

// What a module script can be written in, and what a page may load as one.
let SCRIPT = /\.(?:js|mjs|ts|mts|tsx|jsx)$/

let served = (
  file: { bytes: Uint8Array<ArrayBuffer>; version: string },
  type: string,
  keep: Record<string, string>,
) =>
  new Response(file.bytes, {
    headers: {
      'content-type': type,
      'content-length': String(file.bytes.byteLength),
      [VERSION]: file.version,
      ...keep,
    },
  })
