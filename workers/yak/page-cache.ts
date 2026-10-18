import { decodedPath } from './request-path.ts'
import { possiblePerson } from './directory-copy.ts'
// An app's public pages, kept in Cloudflare's cache at the Site entrypoint
// (T-124419). Every page view used to read the directory twice before a byte
// was sent; a kept page is answered with none of that.
//
// The gateway (apps.ts `served`) asks Site first for a page any visitor could
// be sent, keyed by the hostname it routed, the path and the mount
// (`pageAt`), so two spaces never share a key and one app mounted at two
// addresses keeps two pages. On a miss Site serves the address as an
// anonymous visitor would be served it (apps.ts `edged`), and keeps it only
// when it is the same answer for everyone: the own file or 404 of an app
// anyone may read (public or open), with no worker of its own, no sandbox, no
// router claiming the path and no cookie, or a space's 404 where no app
// answers. Anything else is a pass, kept as briefly as a page.
//
// The gateway remembers, as briefly, every address Site passed and every app
// it served itself whose pages are never kept (`unkept`: a private app's, a
// worker's), and does not ask about them again: such a page pays the hop to
// Site once in a while, not on every view, and a stranger walking an app's
// addresses one by one pays it once.
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
import { mode } from '@yaks/member'
import type { App } from './directory.ts'
import { bearing } from './dispatch.ts'
import type { Env } from './env.ts'
import { sandboxed } from './installed.ts'
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
let GENERATION = 2

// What Site says of a pass for now only (`passed`), which no cache holds.
let UNKEPT = 'private, no-store'

// Between served() and Site, and Site and the gateway; never a browser's.
let KEEP = 'x-yak-keep'
let NOW = 'x-yak-now'
let SEEN = 'x-yak-seen'
let BROWSER = 'x-yak-browser-cache'

// A deploy probe picks a version at the gateway; a miss is served by Site at
// the same one (kernel.ts says the same of the apex's pages).
let PICK = 'Cloudflare-Workers-Version-Overrides'

// What the gateway serves itself lately, per binding (one per isolate in the
// runtime, one per test platform): an address Site passed, or every address
// of an app under its mount (`scope`), until a pass would have gone stale. A
// pass is always safe to act on: the gateway serves the address itself.
let PASS_MS = 30_000
let PASSES = 1_000
let passing = new WeakMap<object, Map<string, number>>()
let remember = (site: object, key: string) => {
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
let scope = (host: string, mount: string | null, at: string) =>
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
 * that makes it one visitor's (a grant, a bearer, a byte range), and not an
 * app's `/api/` or a sandboxed page's token path, which never are. */
export let shareable = (req: Request, path = new URL(req.url).pathname) => {
  return (req.method == 'GET' || req.method == 'HEAD') &&
    !possiblePerson(req) && !req.headers.has('authorization') &&
    !req.headers.has('range') &&
    !req.headers.has('upgrade') && !bearing(req) &&
    !/^(?:\/[^/]+)?\/(?:api\/|_web(?:\/|$))/.test(path) && !path.includes('/~')
}

/** An answer Site may keep: which app it was a page of (none, for a space's
 * own 404), for the gateway's count, and the tags its purge names. An app
 * mid-release (its fence up, versions.ts `fenced`) had its pages purged as
 * the release began (tools.ts `released`), and its commit purges nothing
 * more (facets/pages-graph.ts), so a page of it kept now would outlive the
 * release: it passes, and only for now. */
export let keep = (
  page: Response,
  space: { eid: string; slug: string },
  app: { eid: string; slug: string; fence?: string | null } | null,
) => {
  if (![200, 404].includes(page.status) || page.headers.has('set-cookie')) {
    return passed()
  }
  if (app?.fence) return passed(true)
  let headers = new Headers(page.headers)
  headers.set(
    KEEP,
    [...app ? [appTag(app.eid)] : [], spaceTag(space.eid)].join(','),
  )
  headers.set(
    SEEN,
    JSON.stringify(app ? seen(space, app) : { space: space.slug }),
  )
  return new Response(page.body, { status: page.status, headers })
}

/** Whether Site may keep an app's pages: the own files of an app anyone may
 * read (public or open) and nothing else. A private app's pages are its
 * members', a sandboxed page carries its visitor's token, and an app's worker
 * may answer each visitor differently. */
export let keepable = (
  app: Pick<App, 'access' | 'worker'> & Partial<Pick<App, 'installed'>>,
) =>
  !sandboxed(app as App) && mode(app.access) != 'private' &&
  app.worker === ''

/** That the gateway served an app whose pages are never kept, mounted at
 * `at`: it asks Site about none of the app's addresses for a while. */
export let unkept = (req: Request, env: Env, at: string) => {
  if (env.SITE) {
    remember(env.SITE, scope(hostOf(req, env), req.headers.get(MOUNT), at))
  }
}

/** An address no kept page may answer: the gateway serves it itself. A pass
 * `now` holds for this answer only: neither Site nor the gateway keeps it. */
export let passed = (now = false) =>
  new Response(null, { status: 204, headers: now ? { [NOW]: '1' } : {} })

/** Site's half: served()'s anonymous answer as Site keeps it, or the pass
 * every other answer is. */
export let kept = async (answer: Response) => {
  let tags = answer.headers.get(KEEP)
  if (!tags) {
    await answer.body?.cancel()
    return new Response(null, {
      status: 204,
      headers: { 'cache-control': answer.headers.has(NOW) ? UNKEPT : KEPT },
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
  if (!site) return null
  let path = new URL(req.url).pathname
  if (!shareable(req, path)) return null
  let host = hostOf(req, env)
  let mount = req.headers.get(MOUNT)
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
  if (
    !['HIT', 'UPDATING', 'STALE'].includes(
      got.headers.get('cf-cache-status') ?? '',
    )
  ) {
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
  for (let name of [SEEN, BROWSER, 'age', 'cf-cache-status', 'cache-tag']) {
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
  let at = JSON.parse(said) as Partial<ReturnType<typeof seen>>
  if (at.app && at.slug && at.space) {
    viewed(env, req, answer, { app: at.app, space: at.space, slug: at.slug })
    if (answer.status < 400) scheduleUse(env, at.app)
  }
  return answer
}
