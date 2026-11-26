// The hit path of an app's kept pages and the apex's listings, which both the
// gateway and yak-front (front/) walk: asking Site, and turning what its cache
// holds into a visitor's answer. What a kept page is, where Site keeps it and
// for how long are @yaks/platform/kept's; asking the cache is
// @yaks/workerd/cache's. Nothing here reaches the graph stack or a secret, so
// the front Worker's upload stays small.
import { matches } from '@yaks/blob/serve'
import { EDGE_REGION, edgeRegion } from '@yaks/platform/regional-route'
import { hit } from '@yaks/workerd/cache'
import {
  BROWSER,
  fixed,
  FRESH,
  KEPT,
  listingAt,
  pageAt,
  type Said,
  scope,
  SEEN,
  type Seen,
  shareable,
  TAGS,
  UNKEPT,
  uploaded,
} from '@yaks/platform/kept'
import type { Fetcher } from './env.ts'
import { PATHS } from './variant.ts'
import { COOKIE } from '@yaks/platform/cookie'
import { claimed } from './site-data.ts'

// A deploy probe picks a version at the gateway; a miss is served by Site at
// the same one (kernel.ts says the same of the apex's pages).
let PICK = 'Cloudflare-Workers-Version-Overrides'

/** The front already gave Site its chance to answer this request. */
export let SITE_CHECKED = 'x-yak-site-checked'

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

/** The part of a request clock this path uses; the front Worker keeps none. */
export type Timer = {
  time: <T>(
    name: string,
    work: () => Promise<T>,
    said?: (value: T) => string | null,
  ) => Promise<T>
  include: (timing: string | null) => void
}

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
  signal?: AbortSignal,
) => {
  let path = new URL(req.url).pathname
  if (!shareable(req, path)) return null
  let search = new URL(req.url).search
  let key = pageAt(host, path, mount, undefined, search)
  // The app this path could be: the one its first segment names, or the
  // front page, whose mount is the whole hostname.
  let first = /^\/[^/]+\//.exec(path)?.[0]
  let mounts = [mount ?? '/', ...first && !mount ? [first] : []]
  // A worker's pages may go straight to the gateway while the platform's
  // doors no worker is asked about, its uploads and its release's assets, are
  // still served by Site.
  if (
    passes(site, [
      key,
      ...uploaded(path) || fixed(path)
        ? []
        : mounts.map((at) => scope(host, mount, at)),
    ])
  ) {
    return null
  }
  let pick = req.headers.get(PICK)
  let region = !session && edgeRegion(req)
  // What Site holds at a key, and what it says of it, or null for a pass.
  let held = async (key: string, cookie?: string) => {
    if (signal?.aborted) return null
    let got = await c.time(
      'page',
      () =>
        site.fetch(
          // A kept redirect is the visitor's to follow, not this fetch's.
          new Request(key, {
            headers: {
              ...pick ? { [PICK]: pick } : {},
              ...cookie ? { cookie: `${COOKIE}=${cookie}` } : {},
              ...!cookie && region ? { [EDGE_REGION]: region } : {},
            },
            redirect: 'manual',
          }),
        ),
      (r) => r.headers.get('cf-cache-status'),
    )
    if (signal?.aborted) {
      await got.body?.cancel()
      return null
    }
    // A hit carries the old render's timing, not work done for this view.
    if (!hit(got)) c.include(got.headers.get('server-timing'))
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
    let own = pageAt(host, path, mount, session, search)
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
      TAGS,
      'server-timing',
    ]
  ) {
    headers.delete(name)
  }
  // A kept forward is kept by its path alone, so the visitor's query, a
  // shared link's `ref` or an ad's `utm_*`, goes on with them.
  let to = headers.get('location')
  if (to && search && !to.includes('?')) headers.set('location', to + search)
  let etag = headers.get('etag')
  let answer = etag && matches(req.headers.get('if-none-match'), etag)
    ? new Response(null, { status: 304, headers })
    : new Response(req.method == 'HEAD' ? null : got.body, {
      status: got.status,
      headers,
    })
  if (!answer.body) await got.body?.cancel()
  if (at.handle) answer = claimed(req, answer, at.handle)
  if (at.app && at.slug && at.space) count(answer, at as Seen)
  return answer
}

// ---- the apex's listings ---------------------------------------------------

/** The apex's pages Site keeps, each home page variant's among them
 * (variant.ts); the review and identity doors stay uncached. */
export let LISTINGS = [...new Set([...PATHS, '/gallery', '/integrations'])]

/** The apex's own pages that are the same for every visitor of a release: the
 * site's files (site/mod.ts `PAGES`), the manifest its pages link (the home
 * app's, apps/home), and the guide's pages (docs.ts). Site keeps them too, so
 * a visit never waits on the kernel's placement. */
export let STATICS = [
  '/pricing',
  '/help',
  '/terms',
  '/privacy',
  '/cookies',
  '/acceptable-use',
  '/manifest.webmanifest',
]
let GUIDE = /^\/docs(?:\/[\w-]+)?$/

/** Whether this apex path is a page the home app answers (site.ts `HOME`):
 * each home page variant and the static pages, not the files beside them.
 * Each is the same for everyone: a person who may write it is drawn the
 * pencil by the page's sign-in check (site.ts `pencil`). */
export let homed = (path: string) =>
  (PATHS.includes(path) || STATICS.includes(path)) && !/\.\w+$/.test(path)

/** Whether this apex path is one of those pages. */
export let isStatic = (path: string) =>
  STATICS.includes(path) || GUIDE.test(path)

/** Where the gallery serves an app's chosen screenshot by its sha (gallery.ts
 * `image`). Site keeps each beside the listings that show it, and a listing
 * change purges both. */
export let PICTURES = '/gallery/image/'

/** The sign-in card (identity.ts `GET /login`). A stranger's is the same for
 * everyone, so Site keeps it; a request that could be somebody's, or carries
 * an address to go back to, is identity.ts's to answer (@yaks/platform/kept
 * `stranger`). */
export let LOGIN = '/login'

/** Where @yaks/ui's own guide stands at the apex (ui-guide.ts), beside the
 * site's style guide, as the box serves it at `/ui`. */
export let UI_GUIDE = '/style-guide/ui'

/** Whether Site keeps this apex path: a listing, a picture one shows, a
 * static page, or the stranger's sign-in card. */
export let isListing = (path: string) =>
  LISTINGS.includes(path) || path.startsWith(PICTURES) || isStatic(path) ||
  path == LOGIN

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
  let cached = hit(shown)
  if (cached || shown.headers.get('cache-control') == KEPT) {
    shown = new Response(shown.body, shown)
    if (cached) shown.headers.delete('server-timing')
    if (shown.headers.get('cache-control') == KEPT) {
      shown.headers.set('cache-control', FRESH)
    }
  }
  if (req.method == 'GET') return shown
  await shown.body?.cancel()
  return new Response(null, { status: shown.status, headers: shown.headers })
}
