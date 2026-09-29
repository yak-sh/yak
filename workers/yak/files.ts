// The cached half of serving an app's files and blobs: bytes out of R2, and
// nothing else. This part knows an app's eid, the R2 prefix its bytes live
// under, and their address. It does not know who is asking, and that is the whole
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
import { r2Objects, r2RawObjects } from './lib/objects.ts'
import { mimeOf, type Objects, rangedOpen } from '@yaks/blob'
import { blobAt, immutable } from './cache.ts'
import { releaseFiles } from './release.ts'
import type { Env, Fetcher } from './env.ts'
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

// A release never gains a file after its source is selected. A later release
// gets a different key, so its file can answer after this 404 was cached.
let missing = () =>
  new Response('not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...immutable },
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

// The gateway's way in: the `FILES` binding, so Cloudflare's cache answers
// what it holds, or this module in-process where there is no binding. Not
// every invocation may take that hop. Inside an app worker's own call to the
// kernel (its KERNEL binding, dispatch.ts) Cloudflare refuses it with
// `DataCloneError: This ServiceStub cannot be serialized` (T-44804), and no
// header the gateway reads is sure to say it is in one: app code holds the
// binding itself. So the refusal is the answer: the same bytes, read
// in-process, uncached.
export let door = (env: Env): Fetcher => ({
  fetch: async (req) => {
    if (!env.FILES) return fetch(req, env)
    try {
      return await env.FILES.fetch(req)
    } catch (e) {
      if ((e as Error | null)?.name != 'DataCloneError') throw e
      return fetch(req, env)
    }
  },
})

// The gateway calls this only after checking access and resolving the blob's
// metadata. Range stays a request header: Workers Caching removes it on a
// miss, keeps the full 200 response, and slices a 206 from that one entry.
export let blobBytes = (
  env: Env,
  app: { eid: string },
  prefix: string,
  sha: string,
  range?: string | null,
  method = 'GET',
) =>
  door(env).fetch(
    new Request(blobAt(app.eid, sha), {
      method,
      headers: { [PREFIX]: prefix, ...(range ? { range } : {}) },
    }),
  )

// The inner door. The gateway has already decided this request may be served;
// everything here is about which bytes.
//
export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  if (url.pathname.startsWith('/blob/')) return blob(req, env, url.pathname)
  // `/<app eid>/<the app's own path>` (cache.ts `at`): the eid is the cache
  // key's tenant discriminator and is not part of the file's name.
  let eid = url.pathname.slice(1).split('/')[0] ?? ''
  let path = url.pathname.replace(/^\/[^/]+/, '') || '/'
  let prefix = req.headers.get(PREFIX)
  if (!prefix || !eid) return missing()
  let blobs = releaseFiles(r2Objects(env.BLOBS))
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
      return missing()
    }
    let compiled = built ? await blobs.open(built) : null
    let object = compiled ?? await blobs.open(key)
    if (!object) return missing()
    return rangedOpen(object, req, {
      'content-type': compiled ? mimeOf('compiled.js') : type,
      [VERSION]: object.version,
      ...immutable,
    })
  }
  // A page script the deploy compiled serves in its source's place, as
  // JavaScript whatever its extension (esbuild.ts): `<script type="module"
  // src="main.ts">` gets main.ts compiled. Asked for beside the source, in the
  // same round trip.
  let made = built ? blobs.load(built) : null
  let file = await blobs.load(key)
  if (source && key == keyed(prefix, `/${await source}`)) return missing()
  let compiled = await made
  if (compiled) return served(compiled, mimeOf('compiled.js'))
  if (!file && pretty(path)) {
    key = keyed(prefix, '/')
    file = await blobs.load(key)
  }
  if (!file) return missing()
  return served(file, mimeOf(key))
}

// Only content-addressed bytes cross this cached door. The gateway already
// checked access and keeps the MIME, name and response fence; a missing object
// is not immutable and must never be cached ahead of its upload.
let blob = async (req: Request, env: Env, path: string) => {
  let match = /^\/blob\/[^/]+\/([0-9a-f]{64})$/.exec(path)
  let prefix = req.headers.get(PREFIX)
  let missing = () =>
    new Response('not found', {
      status: 404,
      headers: { 'cache-control': 'private, no-store' },
    })
  if (req.method != 'GET' && req.method != 'HEAD') {
    return new Response(null, {
      status: 405,
      headers: { 'cache-control': 'private, no-store' },
    })
  }
  if (!match || !prefix || !prefix.endsWith('/')) return missing()
  let [, sha] = match
  let object = await r2RawObjects(env.BLOBS).open(prefix + sha)
  if (!object) return missing()
  return rangedOpen(object, req, {
    'content-type': 'application/octet-stream',
    etag: `"${sha}"`,
    ...immutable,
  })
}

// What a module script can be written in, and what a page may load as one.
let SCRIPT = /\.(?:js|mjs|ts|mts|tsx|jsx)$/

let served = (
  file: { bytes: Uint8Array<ArrayBuffer>; version: string },
  type: string,
) =>
  new Response(file.bytes, {
    headers: {
      'content-type': type,
      'content-length': String(file.bytes.byteLength),
      [VERSION]: file.version,
      ...immutable,
    },
  })
