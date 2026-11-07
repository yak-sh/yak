// The hit path of an app's kept pages and the apex's listings, which both the
// gateway and yak-front (front/) walk: asking Site, and turning what its cache
// holds into a visitor's answer. page-cache.ts says what a kept page is and how
// Site keeps one. Nothing here reaches the graph stack or a secret, so the
// front Worker's upload stays small.
import { decodedPath } from './request-path.ts'
import { assetPath } from './asset_url.ts'
import { matches } from './public-cache.ts'
import type { Fetcher } from './env.ts'
import { bearing, MOUNT } from './route.ts'
import { PATHS, shown } from './variant.ts'
import { COOKIE, cookieValue } from '@yaks/platform/cookie'
import { sha256 } from '@yaks/graph/sha256'

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
// Between the gateway and yak-front: the mount of an app whose pages are never
// kept, which it need not ask Site about for a while (page-cache.ts `unkept`).
export let UNKEPT_AT = 'x-yak-unkept'

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
 * the gateway routed, because the cache key holds no hostname of its own.
 * `session` keys a signed-in person's own copy of a page kept for strangers
 * (`asked`): the digest of their session token, which only they hold, so
 * nobody else's request ever reads it, and a forged cookie names a key Site
 * never filled. */
export let pageAt = (
  host: string,
  path: string,
  mount: string | null,
  session?: string,
) =>
  `https://site.invalid/@${encodeURIComponent(host)}${path}?g=${GENERATION}${
    mount ? `&mount=${encodeURIComponent(mount)}` : ''
  }${session ? `&who=${heldBy(session)}` : ''}`

// What a key says of the session it is for.
let heldBy = (session: string) => sha256(session).slice(0, 32)

/** The address a key names, as the request a visitor would have sent: with
 * the session cookie `asking` carries, where the key is that session's own
 * and the cookie is the session it names, else with no cookie at all. */
export let visitor = (url: string, asking?: Request): Request | null => {
  let { pathname, searchParams } = new URL(url)
  let at = pathname.indexOf('/', 2)
  if (!pathname.startsWith('/@') || at < 0) return null
  let host = decodedPath(pathname.slice(2, at))
  if (host == null) return null
  let mount = searchParams.get('mount')
  let headers = new Headers(mount ? { [MOUNT]: mount } : {})
  let session = asking && cookieValue(asking.headers.get('cookie'))
  if (session && searchParams.get('who') == heldBy(session)) {
    headers.set('cookie', `${COOKIE}=${session}`)
  }
  return new Request(`https://${host}${pathname.slice(at)}`, { headers })
}

/** Whether a key is a session's own (`pageAt`). */
export let personal = (url: string) => new URL(url).searchParams.has('who')

/** The platform's modules an app's pages import from its `/api/` (apps.ts
 * `api`): one file for every app, from the platform's assets. */
export let CLIENT = [
  '/client.js',
  '/storage.js',
  '/_draft.js',
  '/_outbox.js',
  '/_wire.js',
]

/** Whether a path names bytes at an app's `/api/` that are the same for
 * everyone who may read the app: a release's asset (asset_url.ts) or one of
 * the platform's modules. A page's first paint loads them, so Site keeps them
 * as it keeps the page. */
export let fixed = (path: string) => {
  let api = /^(?:\/[^/]+)?\/api(\/.+)$/.exec(path)?.[1]
  return !!api && (CLIENT.includes(api) || !!assetPath(api))
}

/** Whether a request could be answered by a kept page: a read with nothing
 * that requires the gateway (a grant, a bearer, a byte range), and not an
 * app's `/api/` (but for its `fixed` bytes) or a sandboxed page's token
 * path, which never are. */
export let shareable = (req: Request, path = new URL(req.url).pathname) => {
  return (req.method == 'GET' || req.method == 'HEAD') &&
    !req.headers.has('authorization') && !req.headers.has('x-yak-caller') &&
    !req.headers.has('range') &&
    !req.headers.has('upgrade') && !bearing(req) &&
    (fixed(path) || !/^(?:\/[^/]+)?\/(?:api\/|_web(?:\/|$))/.test(path)) &&
    !path.includes('/~')
}

/** What a page may say of itself as it answers from the edge. */
export type Seen = { app: string; space: string; slug: string }
/** Whom a kept page alone is for, where it isn't everyone: strangers, or a
 * person signed in who holds no seat in its space (a space's index, as each
 * is shown it). */
export type Alone = 'stranger' | 'outsider'
// What Site says of a kept page: that, and whom it is for alone.
type Said = Partial<Seen> & { [who in Alone]?: true }

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
 * serves it itself. A stranger's page is never a person's: a `session` that
 * names one is answered their own copy (`pageAt`), which Site keeps only
 * while they hold no seat in its space, so a member is always the caller's
 * to serve. A page view is the caller's to count (`count`). */
export let asked = async (
  req: Request,
  site: Pick<Fetcher, 'fetch'>,
  host: string,
  mount: string | null,
  c: Timer,
  count: (answer: Response, at: Seen) => void,
  session: string | null = null,
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
  // What Site holds at a key, and what it says of it, or null for a pass.
  let held = async (key: string, cookie?: string) => {
    let got = await c.time(
      'page',
      () =>
        site.fetch(
          // A kept redirect is the visitor's to follow, not this fetch's.
          new Request(key, {
            headers: {
              ...pick ? { [PICK]: pick } : {},
              ...cookie ? { cookie: `${COOKIE}=${cookie}` } : {},
            },
            redirect: 'manual',
          }),
        ),
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
    return { got, at: JSON.parse(said) as Said }
  }
  let kept = await held(key)
  if (!kept) return null
  // Not a pass: the next stranger is answered from it.
  if (kept.at.stranger && session) {
    await kept.got.body?.cancel()
    let own = pageAt(host, path, mount, session)
    kept = passes(site, [own]) ? null : await held(own, session)
    if (!kept?.at.outsider) {
      await kept?.got.body?.cancel()
      return null
    }
  }
  let { got, at } = kept
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
  // A kept forward is kept by its path alone, so the visitor's query, a
  // shared link's `ref` or an ad's `utm_*`, goes on with them.
  let to = headers.get('location')
  let search = new URL(req.url).search
  if (to && search && !to.includes('?')) headers.set('location', to + search)
  let etag = headers.get('etag')
  let answer = etag && matches(req.headers.get('if-none-match'), etag)
    ? new Response(null, { status: 304, headers })
    : new Response(req.method == 'HEAD' ? null : got.body, {
      status: got.status,
      headers,
    })
  if (!answer.body) await got.body?.cancel()
  if (at.app && at.slug && at.space) count(answer, at as Seen)
  return answer
}

// ---- the apex's listings ---------------------------------------------------

/** The apex's pages Site keeps, each home page variant's among them
 * (variant.ts); the review and identity doors stay uncached. */
export let LISTINGS = [...new Set([...PATHS, '/gallery', '/integrations'])]

/** The apex's own pages that are the same for every visitor of a deploy: the
 * site's files (site/mod.ts `PAGES`) and the guide's pages (docs.ts). Site
 * keeps them too, so a visit never waits on the kernel's placement. */
export let STATICS = [
  '/pricing',
  '/help',
  '/terms',
  '/privacy',
  '/cookies',
  '/acceptable-use',
]
let GUIDE = /^\/docs(?:\/[\w-]+)?$/

/** Whether this apex path is one of those pages. */
export let isStatic = (path: string) =>
  STATICS.includes(path) || GUIDE.test(path)

/** Where the gallery serves an app's chosen screenshot by its sha (gallery.ts
 * `image`). Site keeps each beside the listings that show it, and a listing
 * change purges both. */
export let PICTURES = '/gallery/image/'

/** The sign-in card (identity.ts `GET /login`). A stranger's is the same for
 * everyone, so Site keeps it; a request that could be somebody's, or carries
 * an address to go back to, is identity.ts's to answer (`stranger`). */
export let LOGIN = '/login'

/** Whether a visit to the sign-in card is a stranger's with nowhere to return
 * to: no session cookie and no credentials, so nobody is signed in to be sent
 * on, and no `return` the card would carry forward. */
export let stranger = (req: Request) =>
  !cookieValue(req.headers.get('cookie')) &&
  !req.headers.has('authorization') &&
  !new URL(req.url).searchParams.has('return')

/** Whether Site keeps this apex path: a listing, a picture one shows, a
 * static page, or the stranger's sign-in card. */
export let isListing = (path: string) =>
  LISTINGS.includes(path) || path.startsWith(PICTURES) || isStatic(path) ||
  path == LOGIN

/** The listing a visit to this apex path is answered with: the home page
 * variant its visitor is shown (variant.ts) for `/`, else the path's own. */
export let listed = (req: Request, path: string) =>
  path == '/' ? shown(req).path : path

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
  // A kept redirect (a card's picture) is the visitor's to follow.
  let shown = await site.fetch(
    new Request(listingAt(apex, path), { headers, redirect: 'manual' }),
  )
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
