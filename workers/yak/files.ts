import { type Line } from '@yaks/query'
import { decodedPath } from './request-path.ts'
import { type Clock, clock, timed } from './timing.ts'
// The cached half of serving an app's files and blobs: bytes out of R2, and
// whether the app's rows still name an upload's bytes. This part knows an
// app's eid, the R2 prefix its bytes live under, its store, and their address.
// It does not know who is asking, and that is the whole point — Cloudflare's
// cache sits in front of this entrypoint (@yaks/platform/kept), so anything
// this part could learn about a person would end up shared with strangers.
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
import {
  type Loaded,
  mimeOf,
  type Objects,
  rangedOpen,
  type Representation,
} from '@yaks/blob'
import { servable } from '@yaks/blob/upload'
import { uploads } from '@yaks/platform/uploads'
import {
  inside,
  pretty,
  resolve,
  rootOf,
  servedAt,
  WORKER,
} from '@yaks/platform/files'
import {
  blobAt,
  fileAt,
  immutable,
  keptAt,
  servableAt,
} from '@yaks/platform/kept'
import { through } from '@yaks/workerd/cache'
import { elapsed, hop } from './lib/hops.ts'
import { type Served, storeOf } from './door.ts'
import { answered, metaOf } from './meta.ts'
import { caught, relayed, responding } from './defects.ts'
import type { Env, Fetcher } from './env.ts'
import { BUILT } from '@yaks/platform/versions'
import { drawn, ICON_SVG } from './raster.ts'
import { type Config, parse } from './wrangler_app.ts'
import * as shared from './shared.ts'
import { sharing } from './lib/shared.ts'

// What the gateway tells this part, in headers rather than the path, because
// the path is the cache key and these two are not part of what distinguishes
// one answer from another. Relocating legacy bytes keeps their identity,
// so changing a prefix preserves the cached answer.
export let PREFIX = 'x-yak-prefix'

// The store that holds an app's rows and what it is told of the app
// (directory.ts `storeAt`), as JSON, so this part opens it as the gateway
// does. The same answer whatever it says: told, like the prefix, not keyed.
export let STORE = 'x-yak-store'

/** Where an app's store is, as {@link STORE} carries it. */
export type StoreAt = { name: string; app: Served }

// The bytes' version, handed back so the gateway can build an ETag without
// hashing a response body. A release index carries its SHA; older files use
// the object store's ETag. The full and partial doors use the same version.
export let VERSION = 'x-yak-version'

export { mimeOf } from '@yaks/blob'

// A file's key in the blob store: the app's prefix then its path, a directory
// answering with its index. Decoded, so the key is the name the file was put
// under. Request paths are checked before a key is constructed.
export let keyed = (prefix: string, path: string) =>
  `${prefix}${
    decodeURIComponent(path.endsWith('/') ? `${path}index.html` : path)
  }`

import { ownedPrefix } from './file-root.ts'

export let prefixOf = (
  space: { store: string },
  app: { slug: string; source?: string | null; files?: string | null },
) => app.source ?? ownedPrefix(space, app)

// Which file answered, told back to the gateway: its path inside the served
// folder (`about/index.html`, `404.html`), which is where the page's own
// relative URLs start from. Encoded as a URL path, since a header carries no
// other characters and the gateway writes it into a base href
// (@yaks/platform/woven `baseOf`).
export let FILE = 'x-yak-file'
let encoded = (path: string) =>
  path.split('/').map(encodeURIComponent).join('/')

// A release never gains a file after its source is selected. A later release
// gets a different key, so its file can answer after this 404 was cached.
let missing = () =>
  new Response('not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...immutable },
  })

// A release never gains or changes a file after its source is selected, so an
// isolate keeps what it read of one, for the last few hundred releases it
// served; anything else (a draft's state) is read each time. `kept` is the
// caller's own map of what it read, by the release's prefix.
let RELEASED = /\/\.releases\/[^/]+\/[^/]+$/
let KEPT = 512
export let ofRelease = <T>(
  kept: Map<string, Promise<T>>,
  prefix: string,
  read: () => Promise<T>,
): Promise<T> =>
  RELEASED.test(prefix) ? sharing(kept, prefix, read, KEPT) : read()

// What serving reads of an app's wrangler config: its server source (`main`,
// never served) and the folder its addresses serve (`assets.directory`). Both
// files are asked for at once; an app carries at most one, so the miss is
// unavoidable and paying for it twice over is not.
let configs = new Map<string, Promise<Config>>()
export let configOf = (
  blobs: Pick<Objects, 'read'>,
  prefix: string,
): Promise<Config> =>
  ofRelease(configs, prefix, () =>
    Promise.all([
      blobs.read(`${prefix}/wrangler.jsonc`),
      blobs.read(`${prefix}/wrangler.json`),
    ]).then(([jsonc, json]) => {
      let bytes = jsonc ?? json
      return bytes ? parse(new TextDecoder().decode(bytes)).config : {}
    }))

/** Where a file of an app answers, in a sentence: its address under `at`, or
 * that it is source only, when the app's wrangler config serves a folder
 * (T-124473). `dir` is that folder. */
export let whereIn = (at: string, config: Config) => {
  let dir = config.assets?.directory
  let where = (path: string) => {
    if (!dir) return `${at}${path}`
    let addr = servedAt(config, path)
    return addr == null
      ? `source only, not on the web (the app serves ${dir}/)`
      : `${at}${addr}`
  }
  return Object.assign(where, { dir })
}

/** The folder an app serves, if its config names one, and which of `paths`
 * are outside it: source only, never on the web (T-124474). */
export let sourceOnly = (config: Config, paths: string[]) => {
  let dir = config.assets?.directory
  return {
    dir,
    source: dir ? paths.filter((path) => servedAt(config, path) == null) : [],
  }
}

/** What a deploy says of the folder its app serves, if it serves one. */
export let servesSaid = (dir?: string) =>
  dir
    ? `\nserves ${dir}/ — its front page is ${dir}/index.html; ` +
      'files outside it are source only, not on the web'
    : ''

// The gateway's way in: the `FILES` binding, so Cloudflare's cache answers
// what it holds, or this module in-process where there is no binding or the
// runtime refuses or fails the hop (@yaks/workerd/cache `through`). Inside an
// app worker's own call to the kernel (its KERNEL binding, dispatch.ts) that
// refusal is the answer: the same bytes, read in-process, uncached. A cache
// that answered for want of an answer is reported, and the bytes are read
// in-process the same way, so a person's image still loads.
//
// Each trip is one `files` hop on the request's tally (hops.ts), and its wait
// `files_wait`: a hit never reaches the bucket, so no `r2` counts it.
export let door = (env: Env): Fetcher => ({
  fetch: (req) => {
    hop('files')
    return elapsed('files_wait', async () =>
      relayed(
        await through(env.FILES, req, (asked) => fetch(asked, env), {
          clock: env.CLOCK,
          failed: unanswered,
        }),
      ))
  },
})

// A files cache that answered for want of an answer from Files.
let unanswered = (cached: Response, req: Request) =>
  caught(new Error(`the files cache answered ${cached.status}`), {
    request: `${req.method} files`,
    cache_url: req.url,
    cache_status: cached.headers.get('cf-cache-status'),
    cache_error: cached.headers.get('cf-error-type'),
    cache_origin: cached.headers.get('cf-error-origin'),
    cache_ray: cached.headers.get('cf-ray'),
  })

// An app file's bytes, through the cache (@yaks/platform/kept `fileAt`):
// `Files` is a second entrypoint with Cloudflare's cache in front of it,
// addressed by the app's
// eid, this path and its release, so a warm edge answers without the bucket
// being touched. It is the same call for a private app as for a public one —
// what is cached is the file, and whether this person may have it was decided
// by the gateway before it asked.
//
// Workers Caching strips Range on a miss and requires a full 200 response.
// A seek or HEAD goes to the same file door without that cache; ordinary
// GETs still fill and read the shared full-file cache.
export let fileBytes = (
  env: Env,
  eid: string,
  prefix: string,
  path: string,
  source: string,
  range?: string | null,
  method = 'GET',
) => {
  let req = fileRequest(eid, prefix, path, source, { method, range })
  return range || method == 'HEAD'
    ? fetch(req, env).then(relayed)
    : door(env).fetch(req)
}

// The request for one of an app's files at the Files door. A folder's
// redirect is the browser's to follow (apps.ts `asset`): the binding would
// follow it here and answer the folder's page at the address without its
// slash.
let fileRequest = (
  eid: string,
  prefix: string,
  path: string,
  source: string,
  { method = 'GET', range, signal }: {
    method?: string
    range?: string | null
    signal?: AbortSignal
  } = {},
) =>
  new Request(fileAt(eid, path, source), {
    method,
    headers: { [PREFIX]: prefix, ...(range ? { range } : {}) },
    redirect: 'manual',
    signal,
  })

// The addresses a browser opens for a release's files, pages first: a page
// at its directory, the rest at their own encoded paths, never the app's
// inside, and WARMED of them at most.
///
/// warmed(['index.html', 'sub/index.html']) -> ['/', '/sub/']
/// warmed(['a b.css', 'index.html']) -> ['/', '/a%20b.css']
/// warmed(['worker.js', 'vocab.json', 'seed.json']) -> []
let WARMED = 64
let INDEX = 'index.html'
export let warmed = (paths: string[]) => {
  let page = (path: string) => path == INDEX || path.endsWith(`/${INDEX}`)
  let address = (path: string) =>
    new URL(path, 'https://files.invalid/').pathname
  return [
    ...paths.filter(page).map((p) => address(p.slice(0, -INDEX.length))),
    ...paths.filter((p) => !page(p)).map(address).filter((p) => !inside(p)),
  ].slice(0, WARMED)
}

// A release's first view comes moments after its deploy: the person opens
// what they changed. Every address of a new release misses the cache, and a
// miss goes the long way round (both tiers, this entrypoint, the bucket: most
// of a second, T-124006). So the deploy asks for the release's files once, as
// a view would, through the same door at the same addresses (`fileBytes`),
// and the view finds them cached. A few at a time, and only where the cache
// is (`FILES`): in-process there is nothing to fill.
//
// A warm is a guess at the next view, not a view: it asks the cache alone,
// never `door`. When the cache fails it (a 520, a throw, no answer within
// `wait`), the file is left for its view, which asks the same address
// through `door`, reads the bucket and reports a cache that still fails.
// Read through `door`, a warm reported a failure no person met and then read
// the bucket to fill nothing, and a cache that held an answer back held the
// store's alarm with it, for two minutes once (T-152883).
let AT_ONCE = 8
let WAIT = 10_000
export let warm = async (
  env: Env,
  eid: string,
  source: string,
  paths: string[],
  wait = WAIT,
) => {
  let cache = env.FILES
  if (!cache) return
  // A file's address is its path inside the served folder, and a file
  // outside that folder has none.
  let dir = (await configOf(r2Objects(env.BLOBS), source)).assets?.directory
  let asked = warmed(
    dir
      ? paths.filter((p) => p.startsWith(`${dir}/`))
        .map((p) => p.slice(dir.length + 1))
      : paths,
  )
  let next = 0
  let run = async () => {
    while (next < asked.length) {
      let signal = AbortSignal.timeout(wait)
      let req = fileRequest(eid, source, asked[next++], source, { signal })
      // Read through, never held: the cache keeps what passes it whole.
      await cache.fetch(req)
        .then((got) => got.body?.pipeTo(new WritableStream(), { signal }))
        .catch(() => {})
    }
  }
  await Promise.all(Array.from({ length: AT_ONCE }, run))
}

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

/** What the platform keeps about an app at `prefix` + `name`, a name written
 * once (@yaks/platform/kept `keptAt`), through the cache, or null where
 * nothing is. */
export let keptBytes = async (
  env: Env,
  app: { eid: string },
  prefix: string,
  name: string,
): Promise<Uint8Array | null> => {
  let r = await door(env).fetch(
    new Request(keptAt(app.eid, name), { headers: { [PREFIX]: prefix } }),
  )
  if (r.ok) return new Uint8Array(await r.arrayBuffer())
  if (r.status == 404) {
    await r.body?.cancel()
    return null
  }
  throw await answered(r)
}

/** The representation `rep` of the bytes at `sha` that an app anyone may
 * read still serves, as this part keeps it, or none known (@yaks/blob/upload
 * `servable`). A store that could not say throws what it said. */
export let servableOf = async (
  env: Env,
  app: { eid: string },
  store: StoreAt,
  sha: string,
  rep: string,
): Promise<Representation | null> => {
  let r = await door(env).fetch(
    new Request(servableAt(app.eid, sha, rep), {
      headers: { [STORE]: JSON.stringify(store) },
    }),
  )
  if (r.ok) return await r.json() as Representation
  if (r.status == 404) {
    await r.body?.cancel()
    return null
  }
  throw await answered(r)
}

// What a cache may do with a yes: keep it half a minute, the longest an
// upload deleted meanwhile goes on being served, and then ask again. Never
// past that while it asks, since the answer it would be replaced with is a
// no, which is not kept.
let SERVED = 'public, max-age=30'

// Whether an app's rows still name an upload's bytes, asked before a frozen
// blob address of an app anyone may read is served (uploads.ts `blobDoor`). The
// store is asked what it would tell a stranger, which is the same for
// everyone the gateway lets in, so a yes is kept: a page loading a hundred
// images, or a hundred visitors loading one, costs the store one read per
// address per location every half minute, not one per request (T-124546). A
// no is not kept, and the gateway asks for itself as before. A store that
// fails is answered with what it threw, never kept, and the gateway reports
// it.
let serves = (req: Request, env: Env, path: string) => {
  let match = /^\/servable\/([^/]+)\/([0-9a-f]{64})\/([0-9a-f-]+)$/.exec(path)
  let store = told(req.headers.get(STORE))
  if (!match || !store) return Promise.resolve(no(400))
  let [, app, sha, rep] = match
  let graph = metaOf(storeOf(env.STORE, store.name, store.app))
  return servedAs(() =>
    servable(
      (q) => graph.query(q as Line),
      { scope: app, naming: uploads },
      sha,
      rep,
    )
  )
}

let no = (status: number, body: unknown = null) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'private, no-store' },
  })

/** Files' answer to whether bytes are served, given the store's: a yes the
 * cache may keep, a no or a failure it may not. */
export let servedAs = async (
  ask: () => Promise<Representation | null>,
): Promise<Response> => {
  let found
  try {
    found = await ask()
  } catch (e) {
    let { name, message } = e as Error
    return no(503, { error: name, message })
  }
  return found
    ? Response.json(found, { headers: { 'cache-control': SERVED } })
    : no(404)
}

let told = (said: string | null): StoreAt | null => {
  try {
    let at = JSON.parse(said ?? '')
    return typeof at?.name == 'string' && typeof at?.app?.eid == 'string'
      ? at
      : null
  } catch {
    return null
  }
}

// The inner door. The gateway has already decided this request may be served;
// everything here is about which bytes.
//
export let fetch = (req: Request, env: Env): Promise<Response> => {
  let c = clock()
  return responding(
    () =>
      c.counting(async () => timed(await fileFetch(req, env, c), c, 'file_')),
    { request: 'Files fetch' },
  )
}

let fileFetch = async (req: Request, env: Env, c: Clock): Promise<Response> => {
  let url = new URL(req.url)
  if (url.pathname.startsWith('/' + shared.PREFIX)) {
    return shared.fetch(req, env)
  }
  if (url.pathname.startsWith('/blob/')) return blob(req, env, url.pathname)
  if (url.pathname.startsWith('/kept/')) return kept(req, env, url.pathname)
  if (url.pathname.startsWith('/servable/')) {
    return serves(req, env, url.pathname)
  }
  // `/<app eid>/<the app's own path>` (@yaks/platform/kept `fileAt`): the
  // eid is the cache key's tenant discriminator and is not part of the
  // file's name.
  let eid = url.pathname.slice(1).split('/')[0] ?? ''
  let path = url.pathname.replace(/^\/[^/]+/, '') || '/'
  let prefix = req.headers.get(PREFIX)
  if (!prefix || !eid) return missing()
  // An undecodable path is absent, not a failure of the file service.
  let at = decodedPath(path)
  if (at == null) return missing()
  let blobs = r2Objects(env.BLOBS)
  let config = await c.time('config', () => configOf(blobs, prefix))
  let root = rootOf(prefix, config)
  let key = keyed(root, path)
  // Server source is not a public asset, even when `main` names a nested build
  // output. apps.ts `MANIFEST` already refuses the default `/worker.js` at the
  // gateway; this covers the configured path, which only the config names.
  if (key == keyed(prefix, `/${config.main ?? WORKER}`)) return missing()
  let type = mimeOf(key)
  let resource = path.startsWith('/__packages/')
  // A compiled page script is kept by its source's path from the app's root
  // (esbuild.ts), whatever folder is served.
  let built = SCRIPT.test(key)
    ? `${prefix}/${BUILT}${key.slice(prefix.length + 1)}`
    : resource
    ? keyed(prefix, `/${BUILT}${path.slice(1)}`)
    : null
  if (
    (req.method == 'HEAD' || req.headers.has('range')) &&
    !pretty(path) && !type.startsWith('text/html')
  ) {
    let compiled = built ? await blobs.open(built) : null
    let object = compiled ?? await blobs.open(key)
    if (!object) return path == ICON ? icon(env, blobs, root, eid) : missing()
    return rangedOpen(object, req, {
      'content-type': compiled && !resource ? mimeOf('compiled.js') : type,
      [VERSION]: object.version,
      ...immutable,
    })
  }
  // A page script the deploy compiled serves in its source's place, as
  // JavaScript whatever its extension (esbuild.ts): `<script type="module"
  // src="main.ts">` gets main.ts compiled. Asked for beside the source, in the
  // same round trip. One read, not a stat and then a read (T-33176): the
  // bucket is a round trip away.
  if (built) {
    let [compiled, file] = await Promise.all([
      blobs.load(built),
      blobs.load(key),
    ])
    if (compiled) {
      return served(compiled, resource ? type : mimeOf('compiled.js'))
    }
    return file ? served(file, type, at.slice(1)) : missing()
  }
  let found = await c.time('resolve', () =>
    resolve(
      at,
      (p) => blobs.load(`${root}${p}`),
      config.assets?.not_found_handling,
    ))
  if (found && 'to' in found) {
    return new Response(null, {
      status: 307,
      headers: { location: found.to, ...immutable },
    })
  }
  if (!found) return path == ICON ? icon(env, blobs, root, eid) : missing()
  return served(found.file, mimeOf(found.path), found.path, found.status)
}

// An app's icon.png, where it wrote none, is its icon.svg drawn (raster.ts).
// The drawing belongs to the release as much as the SVG does, so it is cached
// with it. One that failed for a reason of ours answers uncached: the gateway
// serves the platform's tile meanwhile (apps.ts `unwritten`), and the next
// request draws again.
let ICON = '/icon.png'
let icon = async (env: Env, blobs: Objects, prefix: string, eid: string) => {
  let svg = await blobs.load(keyed(prefix, `/${ICON_SVG}`))
  if (!svg) return missing()
  let png = await drawn(env, new TextDecoder().decode(svg.bytes), eid)
  if (typeof png == 'string') return missing()
  if (!png) {
    return new Response('not drawn', {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    })
  }
  return served({ bytes: png, version: svg.version }, 'image/png')
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

// `/kept/<app eid>/<name>` (@yaks/platform/kept `keptAt`): the object at the
// told prefix and the name, kept whole. Nothing kept is not kept either, so the object
// written moments later is found.
let kept = async (req: Request, env: Env, path: string) => {
  let match = /^\/kept\/[^/]+\/(.+)$/.exec(path)
  let prefix = req.headers.get(PREFIX)
  if (req.method != 'GET') return no(405)
  if (!match || !prefix?.endsWith('/')) return no(404)
  let bytes = await r2RawObjects(env.BLOBS).read(prefix + match[1])
  if (!bytes) return no(404)
  return new Response(bytes, {
    headers: { 'content-type': 'application/octet-stream', ...immutable },
  })
}

// What a module script can be written in, and what a page may load as one.
let SCRIPT = /\.(?:js|mjs|ts|mts|tsx|jsx)$/

let served = (
  file: Loaded,
  type: string,
  path?: string,
  status = 200,
) =>
  new Response(file.bytes, {
    status,
    headers: {
      'content-type': type,
      'content-length': String(file.bytes.byteLength),
      [VERSION]: file.version,
      ...(path == null ? {} : { [FILE]: encoded(path) }),
      ...immutable,
    },
  })
