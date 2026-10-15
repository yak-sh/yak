import { type Clock, clock, timed } from './timing.ts'
// The cached half of serving an app's files and blobs: bytes out of R2, and
// whether the app's rows still name an upload's bytes. This part knows an
// app's eid, the R2 prefix its bytes live under, its store, and their address.
// It does not know who is asking, and that is the whole point — Cloudflare's
// cache sits in front of this entrypoint (cache.ts), so anything this part
// could learn about a person would end up shared with strangers.
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
import { servable } from './blob-key.ts'
import { at, blobAt, immutable, servableAt } from './cache.ts'
import { type Served, storeOf } from './door.ts'
import { answered, metaOf } from './meta.ts'
import { seedy } from './seed.ts'
import type { Env, Fetcher } from './env.ts'
import { BUILT } from './versions.ts'
import { drawn, ICON_SVG } from './raster.ts'
import { type Config, type NotFound, parse, WORKER } from './wrangler_app.ts'
import * as shared from './shared.ts'

// What the gateway tells this part, in headers rather than the path, because
// the path is the cache key and these two are not part of what distinguishes
// one answer from another. The prefix moves when an app's slug moves
// (tools.ts `app_set` copies the bytes across), and the same bytes at the new
// prefix are the same answer — so keying on it would throw away a warm cache
// for a rename that changed nothing a visitor sees.
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

// Which file answered, told back to the gateway: its path inside the served
// folder (`about/index.html`, `404.html`), which is where the page's own
// relative URLs start from. Encoded as a URL path, since a header carries no
// other characters and the gateway writes it into a base href.
export let FILE = 'x-yak-file'
let encoded = (path: string) =>
  path.split('/').map(encodeURIComponent).join('/')

/// baseOf('/cookbook/', 'docs/index.html', false) -> '/cookbook/docs/'
/// baseOf('/cookbook/', 'about.html', false) -> '/cookbook/'
/// baseOf('/cookbook/', '404.html', false) -> '/cookbook/'
/// baseOf('/cookbook/', 'admin/index.html', true) -> '/cookbook/'
/** Where a page resolves its relative URLs from, as anywhere on the web: its
 * own folder under the mount `at`, so about/index.html's `../style.css` is the
 * app's. A route, and the 404 page at any depth, answer with a page at the
 * root, so their base is the mount. An app whose folder pages were written
 * against the root base keeps it (`rooted`). `file` is the path that answered
 * (`FILE`). */
export let baseOf = (at: string, file: string, rooted: boolean) =>
  at + (rooted ? '' : file.slice(0, file.lastIndexOf('/') + 1))

// A path whose last segment names no file type is a page's address, not a
// file's: `/about` may be about.html, and a path behind no page at all is a
// route (T-32769), `/recipes/42` asking the app's index.html to open at a
// place. Anything with an extension is a file, and a missing stylesheet must
// never answer HTML.
let pretty = (path: string) => !path.split('/').pop()!.includes('.')
let page = (path: string) => pretty(path) || /\.html?$/i.test(path)

// A release never gains a file after its source is selected. A later release
// gets a different key, so its file can answer after this 404 was cached.
let missing = () =>
  new Response('not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...immutable },
  })

// What serving reads of an app's wrangler config: its server source (`main`,
// never served) and the folder its addresses serve (`assets.directory`). Both
// files are asked for at once; an app carries at most one, so the miss is
// unavoidable and paying for it twice over is not. A release never changes,
// so an isolate keeps what it read of one; anything else is read each time.
let RELEASED = /\/\.releases\/[^/]+\/[^/]+$/
let KEPT_CONFIGS = 512
let configs = new Map<string, Promise<Config>>()
export let configOf = (blobs: Objects, prefix: string): Promise<Config> => {
  let kept = configs.get(prefix)
  if (kept) return kept
  let read = Promise.all([
    blobs.read(`${prefix}/wrangler.jsonc`),
    blobs.read(`${prefix}/wrangler.json`),
  ]).then(([jsonc, json]) => {
    let bytes = jsonc ?? json
    return bytes ? parse(new TextDecoder().decode(bytes)).config : {}
  })
  if (!RELEASED.test(prefix)) return read
  configs.set(prefix, read)
  read.catch(() => configs.delete(prefix))
  for (let old of configs.keys()) {
    if (configs.size <= KEPT_CONFIGS) break
    configs.delete(old)
  }
  return read
}

/** Where an app's served files live: its folder `assets.directory` names,
 * else its root. Nothing outside it answers a request. */
export let rootOf = (prefix: string, config: Config) =>
  config.assets?.directory ? `${prefix}/${config.assets.directory}` : prefix

/**
 * The address under the app a file answers at, or null when it is source only
 * (outside the served folder). A folder's index.html answers at the folder.
 */
///
/// servedAt({ assets: { directory: 'dist' } }, 'dist/about/index.html') -> 'about/'
/// servedAt({ assets: { directory: 'dist' } }, 'dist/app.js') -> 'app.js'
/// servedAt({ assets: { directory: 'dist' } }, 'src/main.ts') -> null
/// servedAt({}, 'index.html') -> ''
export let servedAt = (config: Config, path: string) => {
  let root = rootOf('', config)
  let inside = `/${path}`
  if (!inside.startsWith(`${root}/`)) return null
  return inside.slice(root.length + 1).replace(/(^|\/)index\.html$/, '$1')
}

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

type Found = { path: string; file: Loaded; status: 200 | 404 }

/**
 * Which file answers a path of the served folder, as a static host answers a
 * build's pages: the file itself, a folder's index.html, and a page's address
 * without its extension (`/about` is about.html). A folder asked for without
 * its slash is sent to it (`{to}`), so about/index.html's relative URLs
 * resolve inside about/. A page that is not there follows the app's
 * `assets.not_found_handling` (Cloudflare's own key): `single-page-application`
 * answers a route its index.html, `404-page` the nearest 404.html answered
 * 404, `none` a plain 404. Unset, the root's 404.html answers 404, and
 * without one a route answers index.html. `load` reads a path of the folder.
 */
export let resolve = async (
  path: string,
  load: (path: string) => Promise<Loaded | null>,
  notFound?: NotFound,
): Promise<Found | { to: string } | null> => {
  let first = async (paths: string[], status: 200 | 404 = 200) => {
    for (let p of paths) {
      let file = await load(p)
      if (file) return { path: p.slice(1), file, status }
    }
    return null
  }
  let own = path.endsWith('/')
    ? [`${path}index.html`]
    : pretty(path)
    ? [path, `${path}.html`]
    : [path]
  let found = await first(own)
  if (found) return found
  if (pretty(path) && !path.endsWith('/') && await load(`${path}/index.html`)) {
    return { to: `${encodeURIComponent(path.split('/').pop()!)}/` }
  }
  if (notFound == 'none' || !page(path)) return null
  if (notFound == 'single-page-application') {
    return pretty(path) ? await first(['/index.html']) : null
  }
  if (notFound == '404-page') return await first(nearest(path), 404)
  return await first(['/404.html'], 404) ??
    (pretty(path) ? await first(['/index.html']) : null)
}

// Cloudflare's `404-page`: the 404.html nearest the path, walking up from
// its folder to the root.
///
/// nearest('/a/b/c') -> ['/a/b/404.html', '/a/404.html', '/404.html']
/// nearest('/a/') -> ['/a/404.html', '/404.html']
/// nearest('/x') -> ['/404.html']
export let nearest = (path: string) => {
  let dirs = path.split('/').slice(0, -1)
  return dirs.map((_, i) =>
    `${dirs.slice(0, dirs.length - i).join('/')}/404.html`
  )
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

// The files that are the app's platform manifest rather than its page: the
// server code the dispatch namespace runs (dispatch.ts), the manifest a
// deploy reads, the data it seeds the store with (tools.ts, seed.ts), and
// the notes its person left beside it under either name (standing.ts).
// Those are the app's inside — the platform reads them out of the blob store,
// and a member reads them back through `app_files` — so the door that serves
// the app's pages does not serve them to the web. Before this, `GET
// /weather/worker.js` answered the whole server source to anyone with the link
// (C-32869 item 3).
//
// The test is on the decoded key, not the path, because `/%77orker.js` names
// the same file.
let MANIFEST = new Set([
  '/worker.js',
  '/worker.ts',
  '/wrangler.jsonc',
  '/wrangler.json',
  // What app_deploy installs from and pins (esbuild.ts).
  '/package.json',
  '/package-lock.json',
  // Either format of a declaration (tools.ts `spelled`, M-34605): a `.yml`
  // is the app's inside exactly as much as the `.json` is.
  '/vocab.json',
  '/vocab.yml',
  // The notes file (standing.ts `NOTES`). Written out rather than imported:
  // standing.ts reaches this module through declared.ts, and a set built at
  // module top time cannot wait on a cycle.
  '/NOTES.md',
])

export let inside = (path: string) => MANIFEST.has(path) || seedy(path.slice(1))

// An app file's bytes, through the cache (cache.ts): `Files` is a second
// entrypoint with Cloudflare's cache in front of it, addressed by the app's
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
  // A folder's redirect is the browser's to follow (apps.ts `asset`): the
  // binding would follow it here and answer the folder's page at the address
  // without its slash.
  let req = new Request(at(eid, path, source), {
    method,
    headers: { [PREFIX]: prefix, ...(range ? { range } : {}) },
    redirect: 'manual',
  })
  return range || method == 'HEAD' ? fetch(req, env) : door(env).fetch(req)
}

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
let AT_ONCE = 8
export let warm = async (
  env: Env,
  eid: string,
  source: string,
  paths: string[],
) => {
  if (!env.FILES) return
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
      let got = await fileBytes(env, eid, source, asked[next++], source)
      // Read through, never held: the cache keeps what passes it whole.
      await got.body?.pipeTo(new WritableStream())
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

/** The representation `rep` of the bytes at `sha` that an app anyone may
 * read still serves, as this part keeps it, or none known (blob-key.ts
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
// blob address of an app anyone may read is served (apps.ts `gave`). The
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
  return servedAs(() => servable((q) => graph.query(q), { eid: app }, sha, rep))
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
  return c.counting(async () => timed(await fileFetch(req, env, c), c, 'file_'))
}

let fileFetch = async (req: Request, env: Env, c: Clock): Promise<Response> => {
  let url = new URL(req.url)
  if (url.pathname.startsWith('/' + shared.PREFIX)) {
    return shared.fetch(req, env)
  }
  if (url.pathname.startsWith('/blob/')) return blob(req, env, url.pathname)
  if (url.pathname.startsWith('/servable/')) {
    return serves(req, env, url.pathname)
  }
  // `/<app eid>/<the app's own path>` (cache.ts `at`): the eid is the cache
  // key's tenant discriminator and is not part of the file's name.
  let eid = url.pathname.slice(1).split('/')[0] ?? ''
  let path = url.pathname.replace(/^\/[^/]+/, '') || '/'
  let prefix = req.headers.get(PREFIX)
  if (!prefix || !eid) return missing()
  let blobs = r2Objects(env.BLOBS)
  let config = await c.time('config', () => configOf(blobs, prefix))
  let root = rootOf(prefix, config)
  // Decoded, so a key is the name the file was put under; a malformed escape
  // throws, and the router reports it.
  let at = decodeURIComponent(path)
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
