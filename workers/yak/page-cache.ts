// An app's public pages, kept in Cloudflare's cache at the Site entrypoint
// (T-124419). Every page view used to read the directory twice before a byte
// was sent; a kept page is answered with none of that.
//
// The gateway (apps.ts `served`) asks Site first for a page any visitor could
// be sent, keyed by the hostname it routed, the path and the mount
// (`pageAt`), so two spaces never share a key and one app mounted at two
// addresses keeps two pages. On a miss Site serves the address as an
// anonymous visitor would be served it (apps.ts `edged`), and keeps it only
// when it is the same page for everyone: a public app's own file, with no
// worker of its own, no sandbox, no router claiming the path, a 200 and no
// cookie. Anything else is a pass, kept as briefly as a page, and remembered
// as briefly by each gateway isolate that heard it, so a page that is never
// kept (a private app's, say) pays the hop to Site once in a while and not on
// every view.
//
// A kept page is the page as sent: woven, its base, its home-screen tags, its
// release's addresses, the reporter and the free plan's badge. It is tagged
// with its app and its space, and purged when a directory write changes what
// it shows (facets/pages-graph.ts), before that write answers. Its short
// freshness is the bound on a purge that never happened; past it a visitor is
// answered from the cache while Site serves it again behind them, and a
// failing Site leaves the last good page serving.
//
// The visitor's own answer is the gateway's: it counts the view and the use
// from what the kept page says it was, gives the browser the app's own cache
// rule, and answers a revalidation with a 304.
import { bearing } from './dispatch.ts'
import type { Env } from './env.ts'
import { matches } from './public-cache.ts'
import { appTag, spaceTag } from './purge.ts'
import { hostOf, MOUNT } from './route.ts'
import type { Clock } from './timing.ts'
import { scheduleUse } from './used.ts'
import { seen, viewed } from './views.ts'

// How long Site holds an answer before asking again, and how long past that a
// visitor may still be answered from it while it is asked (stale while it
// revalidates). Purges keep it right; this keeps a missed purge brief.
export let KEPT = 'public, max-age=30, stale-while-revalidate=86400'

// Bumped when how a page is woven changes and kept pages must not wait out
// their freshness: every key moves, and the old pages are never read again.
let GENERATION = 1

// Between served() and Site, and Site and the gateway; never a browser's.
let KEEP = 'x-yak-keep'
let SEEN = 'x-yak-seen'
let BROWSER = 'x-yak-browser-cache'

// A deploy probe picks a version at the gateway; a miss is served by Site at
// the same one (kernel.ts says the same of the apex's pages).
let PICK = 'Cloudflare-Workers-Version-Overrides'

// The addresses Site passed lately, per binding (one per isolate in the
// runtime, one per test platform), until a pass would have gone stale. A pass
// is always safe to act on: the gateway serves the address itself.
let PASS_MS = 30_000
let PASSES = 1_000
let passing = new WeakMap<object, Map<string, number>>()
let passesOf = (site: object) => {
  let held = passing.get(site)
  if (!held) passing.set(site, held = new Map())
  return held
}

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
  let mount = searchParams.get('mount')
  return new Request(
    `https://${decodeURIComponent(pathname.slice(2, at))}${pathname.slice(at)}`,
    { headers: mount ? { [MOUNT]: mount } : {} },
  )
}

/** Whether a request could be answered by a kept page: a read with nothing
 * that makes it one visitor's (a grant, a bearer, a byte range), and not an
 * app's `/api/` or a sandboxed page's token path, which never are. */
export let shareable = (req: Request) => {
  let path = new URL(req.url).pathname
  return (req.method == 'GET' || req.method == 'HEAD') &&
    !req.headers.has('authorization') && !req.headers.has('range') &&
    !req.headers.has('upgrade') && !bearing(req) &&
    !/^(?:\/[^/]+)?\/(?:api\/|_web(?:\/|$))/.test(path) && !path.includes('/~')
}

/** An answer Site may keep: which app it was a page of, for the gateway's
 * count, and the tags its purge names. */
export let keep = (
  page: Response,
  space: { eid: string; slug: string },
  app: { eid: string; slug: string },
) => {
  if (page.status != 200 || page.headers.has('set-cookie')) return passed()
  let headers = new Headers(page.headers)
  headers.set(KEEP, `${appTag(app.eid)},${spaceTag(space.eid)}`)
  headers.set(SEEN, JSON.stringify(seen(space, app)))
  return new Response(page.body, { status: page.status, headers })
}

/** An address no kept page may answer: the gateway serves it itself. */
export let passed = () => new Response(null, { status: 204 })

/** Site's half: served()'s anonymous answer as Site keeps it, or the pass
 * every other answer is. */
export let kept = async (answer: Response) => {
  let tags = answer.headers.get(KEEP)
  if (!tags) {
    await answer.body?.cancel()
    return new Response(null, {
      status: 204,
      headers: { 'cache-control': KEPT },
    })
  }
  let headers = new Headers(answer.headers)
  headers.delete(KEEP)
  headers.set(BROWSER, answer.headers.get('cache-control') ?? '')
  headers.set('cache-control', KEPT)
  headers.set('cache-tag', tags)
  return new Response(answer.body, { status: answer.status, headers })
}

/** The gateway's half: the kept page for this request, counted, or null
 * when Site passed and the gateway serves it itself. */
export let asked = async (req: Request, env: Env, c: Clock) => {
  let site = env.SITE
  if (!site || !shareable(req)) return null
  let key = pageAt(
    hostOf(req, env),
    new URL(req.url).pathname,
    req.headers.get(MOUNT),
  )
  let passes = passesOf(site)
  if ((passes.get(key) ?? 0) > Date.now()) return null
  let pick = req.headers.get(PICK)
  let got = await c.time(
    'page',
    () =>
      site.fetch(new Request(key, { headers: pick ? { [PICK]: pick } : {} })),
    (r) => r.headers.get('cf-cache-status'),
  )
  let said = got.headers.get(SEEN)
  if (!said) {
    await got.body?.cancel()
    passes.delete(key)
    passes.set(key, Date.now() + PASS_MS)
    if (passes.size > PASSES) passes.delete(passes.keys().next().value!)
    return null
  }
  let headers = new Headers(got.headers)
  headers.set('cache-control', headers.get(BROWSER) || 'private, no-cache')
  for (let name of [SEEN, BROWSER, 'age', 'cf-cache-status', 'cache-tag']) {
    headers.delete(name)
  }
  let etag = headers.get('etag')
  let answer = etag && matches(req.headers.get('if-none-match'), etag)
    ? new Response(null, { status: 304, headers })
    : req.method == 'HEAD'
    ? new Response(null, { headers })
    : new Response(got.body, { status: got.status, headers })
  if (!answer.body) await got.body?.cancel()
  let at = JSON.parse(said) as ReturnType<typeof seen>
  viewed(env, req, answer, at)
  scheduleUse(env, at.app)
  return answer
}
