// The hit path of an app's kept pages and the apex's listings, which both the
// gateway and yak-front (front/) walk: asking Site, and turning what its cache
// holds into a visitor's answer. page-cache.ts says what a kept page is and how
// Site keeps one. Nothing here reaches the graph stack or a secret, so the
// front Worker's upload stays small.
import { decodedPath } from './request-path.ts'
import { matches } from './public-cache.ts'
import type { Fetcher } from './env.ts'
import { bearing, MOUNT } from './route.ts'

// How long Site holds an answer before asking again, and how long past that a
// visitor may still be answered from it while it is asked (stale while it
// revalidates). Purges keep it right; this keeps a missed purge brief.
export let KEPT = 'public, max-age=30, stale-while-revalidate=86400'

// Bumped when how a page is woven changes and kept pages must not wait out
// their freshness: every key moves, and the old pages are never read again.
let GENERATION = 2

// What Site says of a pass for now only (`passed`), which no cache holds.
export let UNKEPT = 'private, no-store'

// Between served() and Site, and Site and the gateway; never a browser's.
export let KEEP = 'x-yak-keep'
export let NOW = 'x-yak-now'
export let SEEN = 'x-yak-seen'
export let BROWSER = 'x-yak-browser-cache'

// A deploy probe picks a version at the gateway; a miss is served by Site at
// the same one (kernel.ts says the same of the apex's pages).
let PICK = 'Cloudflare-Workers-Version-Overrides'

// What the caller serves itself lately, per binding (one per isolate in the
// runtime, one per test platform): an address Site passed, or every address
// of an app under its mount (`scope`), until a pass would have gone stale. A
// pass is always safe to act on: the caller serves the address itself.
let PASS_MS = 30_000
let PASSES = 1_000
let passing = new WeakMap<object, Map<string, number>>()
export let remember = (site: object, key: string) => {
  let held = passing.get(site)
  if (!held) passing.set(site, held = new Map())
  held.delete(key)
  held.set(key, Date.now() + PASS_MS)
  if (held.size > PASSES) held.delete(held.keys().next().value!)
}
let passes = (site: object, keys: string[]) => {
  let held = passing.get(site), now = Date.now()
  return !!held && keys.some((key) => (held.get(key) ?? 0) > now)
}
// The addresses one app answers on a hostname: those under its mount, which
// for a space's front page is every one.
export let scope = (host: string, mount: string | null, at: string) =>
  `${host} ${mount ?? ''} ${at}`

/** Where Site keeps one address's page. The hostname is a placeholder for
 * the binding; what names the page is the path, which carries the hostname
 * the gateway routed, because the cache key holds no hostname of its own. */
export let pageAt = (host: string, path: string, mount: string | null) =>
  `https://site.invalid/@${encodeURIComponent(host)}${path}?g=${GENERATION}${
    mount ? `&mount=${encodeURIComponent(mount)}` : ''
  }`

/** The address a key names, as the request a visitor would have sent. */
export let visitor = (url: string): Request | null => {
  let { pathname, searchParams } = new URL(url)
  let at = pathname.indexOf('/', 2)
  if (!pathname.startsWith('/@') || at < 0) return null
  let host = decodedPath(pathname.slice(2, at))
  if (host == null) return null
  let mount = searchParams.get('mount')
  return new Request(
    `https://${host}${pathname.slice(at)}`,
    { headers: mount ? { [MOUNT]: mount } : {} },
  )
}

/** Whether a request could be answered by a kept page: a read with nothing
 * that requires the gateway (a grant, a bearer, a byte range), and not an
 * app's `/api/` or a sandboxed page's token path, which never are. */
export let shareable = (req: Request, path = new URL(req.url).pathname) => {
  return (req.method == 'GET' || req.method == 'HEAD') &&
    !req.headers.has('authorization') && !req.headers.has('x-yak-caller') &&
    !req.headers.has('range') &&
    !req.headers.has('upgrade') && !bearing(req) &&
    !/^(?:\/[^/]+)?\/(?:api\/|_web(?:\/|$))/.test(path) && !path.includes('/~')
}

/** What a page may say of itself as it answers from the edge. */
export type Seen = { app: string; space: string; slug: string }

/** The part of a request clock this path uses; the front Worker keeps none. */
export type Timer = {
  time: <T>(
    name: string,
    work: () => Promise<T>,
    said?: (value: T) => string | null,
  ) => Promise<T>
  include: (timing: string | null) => void
}

let HITS = ['HIT', 'UPDATING', 'STALE']

/** The kept page for this request, or null when Site passed and the caller
 * serves it itself. A page view is the caller's to count (`count`). */
export let asked = async (
  req: Request,
  site: Pick<Fetcher, 'fetch'>,
  host: string,
  mount: string | null,
  c: Timer,
  count: (answer: Response, at: Seen) => void,
) => {
  let path = new URL(req.url).pathname
  if (!shareable(req, path)) return null
  let key = pageAt(host, path, mount)
  // The app this path could be: the one its first segment names, or the
  // front page, whose mount is the whole hostname.
  let first = /^\/[^/]+\//.exec(path)?.[0]
  let mounts = [mount ?? '/', ...first && !mount ? [first] : []]
  if (passes(site, [key, ...mounts.map((at) => scope(host, mount, at))])) {
    return null
  }
  let pick = req.headers.get(PICK)
  let got = await c.time(
    'page',
    () =>
      site.fetch(new Request(key, { headers: pick ? { [PICK]: pick } : {} })),
    (r) => r.headers.get('cf-cache-status'),
  )
  // A hit carries the old render's timing, not work done for this view.
  if (!HITS.includes(got.headers.get('cf-cache-status') ?? '')) {
    c.include(got.headers.get('server-timing'))
  }
  let said = got.headers.get(SEEN)
  if (!said) {
    await got.body?.cancel()
    if (got.headers.get('cache-control') != UNKEPT) remember(site, key)
    return null
  }
  let headers = new Headers(got.headers)
  headers.set('cache-control', headers.get(BROWSER) || 'private, no-cache')
  for (
    let name of [
      SEEN,
      BROWSER,
      'age',
      'cf-cache-status',
      'cache-tag',
      'server-timing',
    ]
  ) {
    headers.delete(name)
  }
  let etag = headers.get('etag')
  let answer = etag && matches(req.headers.get('if-none-match'), etag)
    ? new Response(null, { status: 304, headers })
    : new Response(req.method == 'HEAD' ? null : got.body, {
      status: got.status,
      headers,
    })
  if (!answer.body) await got.body?.cancel()
  let at = JSON.parse(said) as Partial<Seen>
  if (at.app && at.slug && at.space) count(answer, at as Seen)
  return answer
}

// ---- the apex's listings ---------------------------------------------------

/** The apex's pages Site keeps; the review and identity doors stay uncached. */
export let LISTINGS = ['/', '/gallery', '/integrations']

/** Where Site keeps one of them. The hostname is a placeholder for a service
 * binding; the apex is in the path because Workers Caching keys by path and
 * entrypoint, not the request hostname. */
export let listingAt = (apex: string, path: string) =>
  `https://site.invalid/${encodeURIComponent(apex)}${path}`

// What a browser is told of the home page's lifetime: the edge's is its own.
let FRESH = 'public, max-age=30, must-revalidate'

/** A listing for a visitor. The subrequest carries validators and deploy
 * selection, never browser credentials; HEAD uses that same GET and drops only
 * its body. */
export let listing = async (
  req: Request,
  site: Pick<Fetcher, 'fetch'>,
  apex: string,
  path: string,
  uncopied = false,
) => {
  // A deploy probe selects a version at the gateway and at its cached Site
  // entrypoint. Without the override here the body can come from the previous
  // deployment even while the gateway runs the requested version.
  let headers = new Headers()
  for (let name of ['if-none-match', 'cache-control', PICK]) {
    let value = req.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (uncopied) headers.set('x-yak-no-copy', '1')
  let shown = await site.fetch(new Request(listingAt(apex, path), { headers }))
  // A hit carries the old render's timing, not work done for this view, and
  // the home page's lifetime is its edge's: a browser still revalidates it.
  let hit = HITS.includes(shown.headers.get('cf-cache-status') ?? '')
  if (hit || shown.headers.get('cache-control') == KEPT) {
    shown = new Response(shown.body, shown)
    if (hit) shown.headers.delete('server-timing')
    if (shown.headers.get('cache-control') == KEPT) {
      shown.headers.set('cache-control', FRESH)
    }
  }
  if (req.method == 'GET') return shown
  await shown.body?.cancel()
  return new Response(null, { status: shown.status, headers: shown.headers })
}
