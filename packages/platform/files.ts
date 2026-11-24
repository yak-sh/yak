// Which of an app's files answers a request, by the rules every host serves
// a release by: a static host's pages (`/about` is about.html, a folder is its
// index.html), Cloudflare's `assets` keys for the folder served and a path
// with no file behind it, and the app's inside (its server source, its
// manifest, its seed), which never answers at all. Pure: a host hands
// `resolve` the way it reads a file of the served folder (yaks.app's from R2,
// workers/yak files.ts; this machine's from the release directory,
// ./files-routes.ts).
import type { Loaded } from '@yaks/blob'

/** Cloudflare's `assets.not_found_handling`, what answers a path with no
 * file. */
export let NOT_FOUND = ['single-page-application', '404-page', 'none'] as const
export type NotFound = typeof NOT_FOUND[number]

/** Cloudflare's `assets`: the folder of the app's files its addresses serve
 * (a build's `dist` beside the source that made it), and what answers a path
 * with no file. Absent, the app's root is served and a missing page infers
 * its handling. */
export type Assets = { directory?: string; not_found_handling?: NotFound }

/** What serving reads of an app's wrangler config: its server source
 * (`main`, never served) and its `assets`. */
export type Serving = { main?: string; assets?: Assets }

/** The server source an app's config names when it names none. */
export let WORKER = 'worker.js'

/** Extensions eligible for the browser compiler. */
export let script = /\.(?:js|mjs|ts|mts|tsx|jsx)$/

// A path whose last segment names no file type is a page's address, not a
// file's: `/about` may be about.html, and a path behind no page at all is a
// route (T-32769), `/recipes/42` asking the app's index.html to open at a
// place. Anything with an extension is a file, and a missing stylesheet must
// never answer HTML.
/// pretty('/about') -> true
/// pretty('/app.css') -> false
export let pretty = (path: string): boolean =>
  !path.split('/').pop()!.includes('.')

/// page('/about.html') -> true
/// page('/app.css') -> false
export let page = (path: string): boolean =>
  pretty(path) || /\.html?$/i.test(path)

/** Where an app's served files live: its folder `assets.directory` names,
 * else its root. Nothing outside it answers a request. */
/// rootOf('apps/a', { assets: { directory: 'dist' } }) -> 'apps/a/dist'
/// rootOf('apps/a', {}) -> 'apps/a'
export let rootOf = (prefix: string, config: Serving): string =>
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
export let servedAt = (config: Serving, path: string): string | null => {
  let root = rootOf('', config)
  let inside = `/${path}`
  if (!inside.startsWith(`${root}/`)) return null
  return inside.slice(root.length + 1).replace(/(^|\/)index\.html$/, '$1')
}

/** A file that answered a path: its path in the served folder, its bytes,
 * and whether it answers as the page asked for or as the app's 404. */
export type Found = { path: string; file: Loaded; status: 200 | 404 }

/**
 * Which file answers a path of the served folder, as a static host answers a
 * build's pages: the file itself, a folder's index.html, and a page's address
 * without its extension (`/about` is about.html). A folder asked for without
 * its slash is sent to it (`{to}`), so about/index.html's relative URLs
 * resolve inside about/. A page that is not there follows the app's
 * `assets.not_found_handling`: `single-page-application` answers a route its
 * index.html, `404-page` the nearest 404.html answered 404, `none` a plain
 * 404. Unset, the root's 404.html answers 404, and without one a route
 * answers index.html. In every mode a path that repeats itself (`looped`) is
 * no route: the root's 404.html answers it 404, else a plain 404, so a
 * crawler following relative links from a route stops at its first loop.
 * `load` reads a path of the folder.
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
  if (notFound == '404-page') return await first(nearest(path), 404)
  let route = async () => pretty(path) ? await first(['/index.html']) : null
  if (looped(path)) return await first(['/404.html'], 404)
  if (notFound == 'single-page-application') return await route()
  return await first(['/404.html'], 404) ?? await route()
}

// A route that repeats itself, a segment twice in a row or a pair of segments
// twice, is relative links followed from a page served below its own folder
// (`problems/admin/p/api/blob/…/submit/videos/submit/videos/`), never a place
// the app routes to. A value that recurs apart is fine: `/users/1/friends/1`.
///
/// looped('/problems/admin/admin/') -> true
/// looped('/p/api/blob/1/p/api/blob/2/') -> true
/// looped('/users/1/friends/1') -> false
/// looped('/recipes/42') -> false
export let looped = (path: string): boolean => {
  let segs = path.split('/').filter(Boolean)
  let pairs = new Set<string>()
  for (let i = 0; i + 1 < segs.length; i++) {
    let pair = `${segs[i]}/${segs[i + 1]}`
    if (segs[i] == segs[i + 1] || pairs.has(pair)) return true
    pairs.add(pair)
  }
  return false
}

// Cloudflare's `404-page`: the 404.html nearest the path, walking up from
// its folder to the root.
///
/// nearest('/a/b/c') -> ['/a/b/404.html', '/a/404.html', '/404.html']
/// nearest('/a/') -> ['/a/404.html', '/404.html']
/// nearest('/x') -> ['/404.html']
export let nearest = (path: string): string[] => {
  let dirs = path.split('/').slice(0, -1)
  return dirs.map((_, i) =>
    `${dirs.slice(0, dirs.length - i).join('/')}/404.html`
  )
}

// An app's inside: what the platform reads of it, never what its addresses
// answer with. The test is on the decoded path, not the request's, because
// `/%77orker.js` names the same file.
let MANIFEST = new Set([
  '/worker.js',
  '/worker.ts',
  '/wrangler.jsonc',
  '/wrangler.json',
  // What app_deploy installs from and pins (workers/yak esbuild.ts).
  '/package.json',
  '/package-lock.json',
  // Either format of a declaration (./manifest.ts `VOCABS`): a `.yml` is the
  // app's inside exactly as much as the `.json` is.
  '/vocab.json',
  '/vocab.yml',
  // The notes file (workers/yak standing.ts `NOTES`).
  '/NOTES.md',
  // The app's redirects (workers/yak redirects.ts): rules for the gateway.
  '/_redirects',
])

/** The bundle formats, for the file beside index.html. A `.csv` is not one:
 * a spreadsheet needs to be told which component a row is, which only a load
 * that names it can say. */
let BUNDLES = ['.yml', '.json']

/** A file the app is seeded from: `seed.yml` or `seed.json` beside
 * index.html, or either of those in a `seed/` folder beside it. */
/// seedy('seed.yml') -> true
/// seedy('seed/people.json') -> true
/// seedy('seeds.json') -> false
export let seedy = (path: string): boolean =>
  BUNDLES.some((e) => path == `seed${e}`) ||
  (path.startsWith('seed/') && BUNDLES.some((e) => path.endsWith(e)))

/** Whether a decoded path is the app's inside, which no address answers. */
/// inside('/vocab.json') -> true
/// inside('/seed.yml') -> true
/// inside('/index.html') -> false
export let inside = (path: string): boolean =>
  MANIFEST.has(path) || seedy(path.slice(1))

/** A request's path decoded to the file it names, or null where it names
 * none: an incomplete escape, invalid UTF-8, a NUL, or a `.` or `..` segment,
 * which would name a file outside the folder it is read from. */
/// decoded('/a%20b.css') -> '/a b.css'
/// decoded('/%2e%2e/secret') -> null
/// decoded('/%E0%A4%A') -> null
export let decoded = (path: string): string | null => {
  let at: string
  try {
    at = decodeURIComponent(path)
  } catch {
    return null
  }
  if (at.includes('\0') || at.includes('\\')) return null
  return at.split('/').some((p) => p == '.' || p == '..') ? null : at
}

// Match strings before comments so URLs and quoted comment markers survive.
// Whitespace preserves token boundaries: `1/* comment */2` must stay invalid.
/// JSON.parse(jsonc('{"a": "//x", /* b */ "c": [1,],}')) -> { a: '//x', c: [1] }
export let jsonc = (source: string): string =>
  source.replace(
    /"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (s) => s.startsWith('"') ? s : s.replace(/[^\r\n]/g, ' '),
  ).replace(/"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g, (s) => s == ',' ? '' : s)

// A folder of the app as a config names it, without its `./` or its last
// slash, and '' for the app's root; null for anything that is not one.
///
/// folder('./dist/') -> 'dist'
/// folder('site/public') -> 'site/public'
/// folder('.') -> ''
/// folder('../elsewhere') -> null
/// folder('/dist') -> null
export let folder = (v: unknown): string | null => {
  if (typeof v != 'string') return null
  let path = v.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
  if (path == '' || path == '.') return ''
  let parts = path.split('/')
  return parts.every((p) =>
      /^[A-Za-z0-9_.-]+$/.test(p) && p != '.' && p != '..'
    )
    ? path
    : null
}

/** What serving honors of a wrangler config's text, and nothing it would
 * refuse: a host that deploys checks the whole config (workers/yak
 * wrangler_app.ts `parse`), and one serving a release as it stands reads
 * only these, leaving out what is not one. */
/// serving('{"assets": {"directory": "./dist/"}}') -> { assets: { directory: 'dist' } }
/// serving('{"main": "src/w.js", "assets": {"not_found_handling": "none"}}') -> { main: 'src/w.js', assets: { not_found_handling: 'none' } }
/// serving('{"assets": {"directory": "../up"}}') -> {}
/// serving('not json') -> {}
export let serving = (text: string): Serving => {
  let value: { main?: unknown; assets?: Record<string, unknown> }
  try {
    value = JSON.parse(jsonc(text)) ?? {}
  } catch {
    return {}
  }
  let config: Serving = {}
  if (typeof value.main == 'string') {
    config.main = value.main.replace(/^(?:\.\/)+/, '')
  }
  let { directory, not_found_handling } = value.assets ?? {}
  let dir = folder(directory)
  let handling = NOT_FOUND.find((n) => n == not_found_handling)
  let assets: Assets = {
    ...(dir ? { directory: dir } : {}),
    ...(handling ? { not_found_handling: handling } : {}),
  }
  if (Object.keys(assets).length) config.assets = assets
  return config
}
