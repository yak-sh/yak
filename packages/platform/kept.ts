/**
 * `@yaks/platform/kept` — what a shared cache may keep of a hosted app, under
 * which address, and for how long. Pure: the host's cache is the runtime's
 * (on yaks.app, Cloudflare's, at the Worker's `Files` and `Site` entrypoints
 * through `@yaks/workerd/cache`), and the host asks it and fills it.
 *
 * ── Why no cache sits in front of the door a browser reaches ──────────────
 *
 * Cloudflare's key for a Worker's cache is the path, the query and the
 * entrypoint, shared across the Worker's versions. It is not the hostname,
 * and every space is a hostname: they all share one path namespace, so
 * `alice.yaks.app/app/x.css` and `bob.yaks.app/app/x.css` are one key, and a
 * custom domain serving its app at `/` collides with every other front page.
 * Caching the door the browser reaches would serve one space's bytes to
 * another's visitors on the second request.
 *
 * So that door, the gateway, is uncached and runs on every request, and the
 * caches stand behind it on inner entrypoints it asks at addresses that name
 * the tenant in their path, which is all a key is made of. A hit still runs
 * the gateway; what it skips is the round trip to the bucket and the work of
 * assembling the page.
 *
 * ── An app's bytes ────────────────────────────────────────────────────────
 *
 * Files keeps an app's bytes, never anybody's response (`fileAt`, `blobAt`,
 * `keptAt`, `servableAt`, `packageAt`). The bytes of `style.css` are the same
 * whoever may read them; what differs per person is only whether they may,
 * and that is decided in front, on every request. So a private app's file is
 * as cacheable as a public one, and a mistake here makes something slow, not
 * wrong: nothing kept is one person's private response.
 *
 * ── An app's pages ────────────────────────────────────────────────────────
 *
 * Site keeps whole pages, so it keeps only an answer that is the same for
 * everyone it could be sent to (`keepable`, `keep`): the own file or 404 of
 * an app anyone may read, with no worker of its own, no sandbox, no router
 * claiming the path and no cookie, the release files of a private one anyone
 * may install, a space's 404 where no app answers, or its index as a stranger
 * sees it. A person signed in who holds no seat in the space is shown its
 * index as such an outsider, kept under their own session (`pageAt`); a
 * member's is never kept. Anything else is a pass, kept as briefly as a page.
 *
 * A page is keyed by the hostname routed, the path and the mount (`pageAt`),
 * so two spaces never share a key and one app mounted at two addresses keeps
 * two pages. It is tagged with its app and its space (`appTag`, `spaceTag`)
 * and purged when what it shows changes; its short freshness (`KEPT`) is the
 * bound on a purge that never happened, and past it a visitor is answered
 * from the cache while it is served again behind them.
 *
 * ```ts
 * import { fileAt, pageAt } from '@yaks/platform/kept'
 * import { assertNotEquals } from '@std/assert'
 * assertNotEquals(fileAt('app-a', '/x.css'), fileAt('app-b', '/x.css'))
 * assertNotEquals(pageAt('ada.yaks.app', '/', null), pageAt('bo.yaks.app', '/', null))
 * ```
 *
 * @module
 */
import { matches } from '@yaks/blob/serve'
import { addressed } from '@yaks/blob'
import { sha256 } from '@yaks/graph/sha256'
import { mode } from '@yaks/member/words'
import { COOKIE, cookieValue } from './cookie.ts'
import { decoded } from './files.ts'
import { apex, type Host, url } from './host.ts'
import { offered, sandboxed } from './installs.ts'
import { bearing, MOUNT, previews } from './routes.ts'
import { assetPath } from './versions.ts'

// ── An app's bytes, at Files ───────────────────────────────────────────────

// A release source never changes. A new release gets a new key, so old
// entries can expire on their own without a purge.
let YEAR = 31536000

/** What Files says of bytes that cannot change under their key: source-named
 * files and content-addressed blobs. Metadata and access are decided by the
 * gateway, outside this cache. */
export let immutable: { 'cache-control': string } = {
  'cache-control': `public, max-age=${YEAR}, immutable`,
}

/** What the gateway tells a browser of the same bytes: it may keep the exact
 * asset it fetched, while a shared cache must never retain the gateway's
 * answer for a person. */
export let browserImmutable: string = `private, max-age=${YEAR}, immutable`

// Files' local Cache API entries survive deploys, so a deploy of the platform
// leaves every app's cached bytes in place. An address's answer is a release's immutable bytes,
// but how Files frames them (a type, a header, a compiled script) is code: a
// change to that for addresses already answered bumps this number, which
// moves every address to a new key and lets the old entries expire unread.
let FILES = 4
let generation = (address: string) =>
  `${address}${address.includes('?') ? '&' : '?'}g=${FILES}`

/**
 * Where Files keeps one of an app's files. The hostname is a placeholder
 * that never resolves (the request goes over a service binding), and
 * everything that tells one answer from another is in the path and query,
 * which are what the key is made of:
 * `/<app eid>/<the app's own path>?source=<release source>&g=<generation>`.
 *
 * The eid and not the slug, because an app answers at every address it has
 * ever had, a rename leaves the old one resolving, and a custom domain is a
 * third address for the same bytes: those are one entry, and a rename cannot
 * make one app read another's. The release source keeps old and new bytes
 * apart when the serving pointer moves.
 */
/// fileAt('a', '/x.css', 'ada/.releases/1/r') -> 'https://files.invalid/a/x.css?source=ada%2F.releases%2F1%2Fr&g=4'
/// fileAt('a', 'x.css') -> 'https://files.invalid/a/x.css?g=4'
export let fileAt = (eid: string, path: string, source = ''): string =>
  generation(
    `https://files.invalid/${eid}${path.startsWith('/') ? '' : '/'}${path}${
      source ? `?source=${encodeURIComponent(source)}` : ''
    }`,
  )

/** Where Files keeps a blob's bytes. A blob has no mutable file path, so its
 * entry is apart from the app's files, and names both the app and the
 * content, so neither tenant nor upload can reuse another's. */
/// blobAt('a', 'ab') -> 'https://files.invalid/blob/a/ab?g=4'
export let blobAt = (eid: string, sha: string): string =>
  generation(`https://files.invalid/blob/${eid}/${sha}`)

/** Where Files keeps an object the platform keeps about an app under a name
 * written once, such as a release's declaration. Where in the bucket it lives
 * is told beside the key, as a blob's is. */
/// keptAt('a', 'declared/r.json') -> 'https://files.invalid/kept/a/declared/r.json?g=4'
export let keptAt = (eid: string, name: string): string =>
  generation(`https://files.invalid/kept/${eid}/${name}`)

/** Where Files keeps whether an app's rows still name the bytes at `sha` as
 * representation `rep`, while the app's `withdrawn` mark stands. Both are in
 * the key: one upload may be framed under more than one representation, and
 * each is its own answer. The mark moves whenever the app's rows stop naming
 * an upload, so every answer kept under the last one is asked again. */
/// servableAt('a', 'ab', 'r') -> 'https://files.invalid/servable/a/ab/r?g=4'
/// servableAt('a', 'ab', 'r', 'm') -> 'https://files.invalid/servable/a/ab/r?withdrawn=m&g=4'
export let servableAt = (
  eid: string,
  sha: string,
  rep: string,
  withdrawn?: string | null,
): string =>
  generation(
    `https://files.invalid/servable/${eid}/${sha}/${rep}${
      withdrawn ? `?withdrawn=${encodeURIComponent(withdrawn)}` : ''
    }`,
  )

/** Where Files keeps a compiler-owned package file, the same for every app. */
/// packageAt('/__packages/d/mod.js') -> 'https://files.invalid/__packages/d/mod.js?g=4'
export let packageAt = (path: string): string =>
  generation(`https://files.invalid${path}`)

// ── What the gateway sends ─────────────────────────────────────────────────

/**
 * The gateway's answer as it leaves, its cache default made to stick.
 *
 * Omitting `Cache-Control` is not opting out of a cache: Cloudflare applies
 * RFC 9111 heuristic freshness and holds a bare `200` for two hours. The
 * gateway is uncached, so nothing it forgets to mark is stored, but that is a
 * line in a config, and the day someone enables caching there every unmarked
 * door would silently become shared. So an answer that states its own policy
 * keeps it, and one that says nothing gets `private, no-store`. A 101 carries
 * the runtime's own socket, which no Response constructor can copy, so a
 * socket passes untouched.
 *
 * Framing (T-33409): an app is a framed resource, and only its own space
 * (its own origin, `'self'`: a space's apps share its hostname, so they frame
 * each other) and the platform's own home page may embed it. Any other
 * space's page is refused by the browser, which is the whole clickjacking
 * defense: a same-site frame would otherwise carry the viewer's session
 * cookie and load signed in, and the browser is the one thing that knows the
 * full ancestor chain. On the apex's own pages it only governs who may frame
 * them, never what they may frame. Appended, not set, so it stacks with an
 * answer's own policy (a blob's sandbox) and no app can widen past it.
 */
export let sealed = (res: Response, env: Host = {}): Response => {
  if (res.status == 101) return res
  let headers = new Headers(res.headers)
  headers.append(
    'content-security-policy',
    `frame-ancestors 'self' ${url(env)}`,
  )
  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'private, no-store')
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

/**
 * A public page drawn from this deploy's own files, validated by the deploy,
 * the apex, its path and any `variant` of it, so the next deploy changes its
 * validator and a conditional hit never draws it. Kept `maxAge` seconds and
 * then revalidated; where no deploy is known (a local run), never kept.
 */
export let publicPage = async (
  req: Request,
  env: Host,
  path: string,
  draw: () => Promise<Response | null> | Response | null,
  maxAge = 300,
  variant = '',
): Promise<Response | null> => {
  let id = env.CF_VERSION_METADATA?.id
  let etag = id
    ? `W/"${encodeURIComponent(`${id}:${apex(env)}:${path}:${variant}`)}"`
    : null
  let headers = new Headers({
    'cache-control': etag
      ? `public, max-age=${maxAge}, must-revalidate`
      : 'private, no-store',
  })
  if (etag) headers.set('etag', etag)
  if (matches(req.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers })
  }
  let answer = await draw()
  if (!answer || answer.status != 200) return answer
  let copied = new Headers(answer.headers)
  headers.forEach((value, name) => copied.set(name, value))
  return new Response(req.method == 'HEAD' ? null : answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers: copied,
  })
}

// ── An app's pages, at Site ────────────────────────────────────────────────

/** How long Site holds a page before asking again, and how long past that a
 * visitor may still be answered from it while it is asked (stale while it
 * revalidates). Purges keep it right; this keeps a missed purge brief. */
export let KEPT = 'public, max-age=30, stale-while-revalidate=86400'

/** What Site says of a pass for now only (`passed`), which no cache holds. */
export let UNKEPT = 'private, no-store'

/** What a browser is told of a listing's lifetime: the edge's is its own. */
export let FRESH = 'public, max-age=30, must-revalidate'

/** The header a kept answer names its purge tags in. */
export let TAGS = 'cache-tag'

// Between the gateway's serving and Site, and Site and the gateway; never a
// browser's.
/** The purge tags of an answer Site may keep (`keep`). */
export let KEEP = 'x-yak-keep'
/** That an answer passes for now only (`passed`). */
export let NOW = 'x-yak-now'
/** What a kept page says of itself (`Seen`, `Alone`). */
export let SEEN = 'x-yak-seen'
/** The browser's own cache rule, carried past Site's. */
export let BROWSER = 'x-yak-browser-cache'
/** Between the gateway and an edge in front of it: the mount of an app whose
 * pages are never kept, which it need not ask Site about for a while. */
export let UNKEPT_AT = 'x-yak-unkept'

/** The tag on every answer the site keeps, purged when a space is created or
 * renamed. */
export let SITE_TAG = 'site'
/** The tag on every answer an app gave. */
export let appTag = (eid: string): string => `app:${eid}`
/** The tag on every answer in a space. */
export let spaceTag = (eid: string): string => `space:${eid}`
/** The tag on every answer at a custom domain's own address, by its hostname
 * row: attaching, detaching or moving it takes them out. */
export let hostTag = (eid: string): string => `host:${eid}`
/** The tag on a listed app's picture when its files choose it, which a
 * release can change and the listings beside it cannot. */
export let cardTag = (eid: string): string => `card:${eid}`

// Bumped when how a page is woven changes and kept pages must not wait out
// their freshness: every key moves, and the old pages are never read again.
let PAGES = 4

// What a key says of the session it is for.
let heldBy = (session: string) => sha256(session).slice(0, 32)

/** Where Site keeps one address's page. The hostname is a placeholder for
 * the binding; what names the page is the path, which carries the hostname
 * the gateway routed, because the key holds no hostname of its own.
 * `session` keys a signed-in person's own copy of a page kept for strangers:
 * the digest of their session token, which only they hold, so nobody else's
 * request ever reads it, and a forged cookie names a key Site never filled. */
/// pageAt('ada.yaks.app', '/menu/', '/menu/') -> 'https://site.invalid/@ada.yaks.app/menu/?g=4&mount=%2Fmenu%2F'
export let pageAt = (
  host: string,
  path: string,
  mount: string | null,
  session?: string,
): string =>
  `https://site.invalid/@${encodeURIComponent(host)}${path}?g=${PAGES}${
    mount ? `&mount=${encodeURIComponent(mount)}` : ''
  }${session ? `&who=${heldBy(session)}` : ''}`

/** The address a key names, as the request a visitor would have sent: with
 * the session cookie `asking` carries, where the key is that session's own
 * and the cookie is the session it names, else with no cookie at all. */
export let visitor = (url: string, asking?: Request): Request | null => {
  let { pathname, searchParams } = new URL(url)
  let at = pathname.indexOf('/', 2)
  if (!pathname.startsWith('/@') || at < 0) return null
  let host = decoded(pathname.slice(2, at))
  if (host == null) return null
  let mount = searchParams.get('mount')
  let headers = new Headers(mount ? { [MOUNT]: mount } : {})
  let session = asking && cookieValue(asking.headers.get('cookie'))
  if (session && searchParams.get('who') == heldBy(session)) {
    headers.set('cookie', `${COOKIE}=${session}`)
  }
  // An upload's fill may take Files' yes: it is kept under its app's mark,
  // which moves the moment an upload is withdrawn, so only this keep's own
  // freshness bounds a removed upload.
  return new Request(`https://${host}${pathname.slice(at)}`, { headers })
}

/** Whether a key is a session's own (`pageAt`). */
export let personal = (url: string): boolean =>
  new URL(url).searchParams.has('who')

/** The addresses one app answers on a hostname: those under its mount, which
 * for a space's front page is every one. */
export let scope = (host: string, mount: string | null, at: string): string =>
  `${host} ${mount ?? ''} ${at}`

/** The platform's modules an app's pages import from its `/api/`: one file
 * for every app. */
export let CLIENT: string[] = [
  '/client.js',
  '/storage.js',
  '/_draft.js',
  '/_outbox.js',
  '/_wire.js',
  '/_edit.js',
]

/** The store client under a name of its bytes, the address a page of
 * modules imports it by. */
export let NAMED_CLIENT: RegExp = /^\/client\.[0-9a-f]{10}\.js$/

/** Whether a path names bytes at an app's `/api/` that are the same for
 * everyone who may read the app: a release's asset or one of the platform's
 * modules. A page's first paint loads them, so Site keeps them as it keeps
 * the page. */
/// fixed('/menu/api/client.js') -> true
/// fixed('/menu/api/who') -> false
export let fixed = (path: string): boolean => {
  let api = /^(?:\/[^/]+)?\/api(\/.+)$/.exec(path)?.[1]
  return !!api &&
    (CLIENT.includes(api) || NAMED_CLIENT.test(api) || !!assetPath(api))
}

/** A complete upload representation, whose bytes and headers are fixed but
 * whose row must still exist. Unlike `fixed`, these are private app data,
 * even when the app's release is offered for installation. */
export let uploaded = (path: string): boolean => {
  let blob = /^(?:\/[^/]+)?\/api\/blob\/(.+)$/.exec(path)?.[1]
  return !!blob && !!addressed(blob)?.eid
}

/** Whether a request could be answered by a kept page: a read with nothing
 * that requires the gateway (a grant, a bearer, a byte range), and not an
 * app's `/api/` (but for its `fixed` bytes and `uploaded` representations), a sandboxed page's token path
 * or a draft's preview link, which never are. */
export let shareable = (
  req: Request,
  path: string = new URL(req.url).pathname,
): boolean =>
  (req.method == 'GET' || req.method == 'HEAD') &&
  !req.headers.has('authorization') && !req.headers.has('x-yak-caller') &&
  !req.headers.has('range') &&
  !req.headers.has('upgrade') && !bearing(req) &&
  (fixed(path) || uploaded(path) ||
    !/^(?:\/[^/]+)?\/(?:api\/|_web(?:\/|$))/.test(path)) &&
  !path.includes('/~') && !previews(path)

/** What a page may say of itself as it answers from the edge: its app, its
 * space and slug, the store its app keeps, which a page that `opens` starts,
 * and its space's handle, which the browser is told the hostname's storage is
 * now. A page kept before it said either says none. */
export type Seen = {
  app: string
  space: string
  slug: string
  store?: string
  handle?: string
}

/** Whether a browser goes on to run this answer, so that its scripts ask the
 * app's store next: an HTML page, sent whole or revalidated. */
export let opens = (res: Response): boolean =>
  (res.status == 200 || res.status == 304) &&
  (res.headers.get('content-type') ?? '').startsWith('text/html')

/** Whom a kept page alone is for, where it isn't everyone: strangers, or a
 * person signed in who holds no seat in its space (a space's index, as each
 * is shown it). */
export type Alone = 'stranger' | 'outsider'

/** What Site says of a kept page: what it `Seen`s, and whom it is for
 * alone. */
export type Said = Partial<Seen> & { [who in Alone]?: true }

/** An address no kept page may answer: the gateway serves it itself. A pass
 * `now` holds for this answer only: neither Site nor the gateway keeps it. */
export let passed = (now = false): Response =>
  new Response(null, { status: 204, headers: now ? { [NOW]: '1' } : {} })

/** What a page Site may keep is of: the space and app its purge names (none,
 * for a space's own 404 or index; no space, for a missing one), what it says
 * of itself, and the app's release fence, if one is up. */
export type Of = {
  space: { eid: string } | null
  app: { eid: string; fence?: string | null } | null
  seen: Partial<Seen>
}

/** An answer Site may keep, tagged for its purge and saying what it is (`Of`):
 * a page or a 404, unless the caller names other `statuses` the same for
 * everyone, and for everyone unless it is a stranger's or an outsider's
 * `alone`. An app mid-release had its pages purged as the release began, and
 * its commit purges nothing more, so a page of it kept now would outlive the
 * release: it passes, and only for now. */
export let keep = (
  page: Response,
  of: Of,
  statuses: number[] = [200, 404],
  alone?: Alone,
): Response => {
  if (!statuses.includes(page.status) || page.headers.has('set-cookie')) {
    return passed()
  }
  if (of.app?.fence) return passed(true)
  let headers = new Headers(page.headers)
  headers.set(
    KEEP,
    [
      ...of.app ? [appTag(of.app.eid)] : [],
      of.space ? spaceTag(of.space.eid) : SITE_TAG,
    ].join(','),
  )
  headers.set(
    SEEN,
    JSON.stringify({ ...of.seen, ...alone ? { [alone]: true } : {} }),
  )
  return new Response(page.body, { status: page.status, headers })
}

/** An app as `keepable` reads it. */
export type Keepable = {
  access: unknown
  worker?: string | null
  installed?: { sandboxed?: string | null } | null
  published?: unknown
}

/** Whether Site may keep an app's answer at `path`, or with no path, at any
 * of its addresses: every own file of an app anyone may read (public or
 * open), and the `fixed` bytes of one anyone may install (`offered`), which
 * its pages load first. A private app's pages and data are its members', a
 * sandboxed page carries its visitor's token, and an app's worker may answer
 * each visitor differently.
 *
 * ```ts
 * import { keepable } from '@yaks/platform/kept'
 * import { assert } from '@std/assert'
 * let css = '/api/assets/fdcc9a38-0b6b-4f8c-bcbd-15bad97cee69/style.css'
 * let published = { name: 'notes', version: 2, at: '', about: '' }
 * let app = { access: 'private', worker: '', published }
 * assert(keepable(app, css) && keepable(app, '/api/client.js'))
 * assert(keepable(app) && !keepable(app, '/') && !keepable(app, '/api/who'))
 * assert(!keepable({ ...app, published: null }))
 * ```
 */
export let keepable = (app: Keepable, path?: string): boolean =>
  !sandboxed(app) && app.worker === '' &&
  (mode(app.access) != 'private' ||
    offered(app) && (path == null || fixed(path)))

/** Site's half: the gateway's anonymous answer as Site keeps it, or the pass
 * every other answer is. At a session's own key (`personal`) that is only
 * the page drawn for an outsider: whatever else it served the person is
 * everyone's, kept at its own key, or theirs alone, which is never kept.
 * An upload at `path` is kept only until its servability must be asked again,
 * with neither stale answers nor cached misses. */
export let kept = async (
  answer: Response,
  personal = false,
  path = '',
): Promise<Response> => {
  let upload = uploaded(path)
  let tags = answer.headers.get(KEEP)
  let alone = JSON.parse(answer.headers.get(SEEN) ?? '{}') as Said
  if (!tags || personal && !alone.outsider || upload && answer.status != 200) {
    await answer.body?.cancel()
    return new Response(null, {
      status: 204,
      headers: {
        'cache-control': upload || answer.headers.has(NOW) ? UNKEPT : KEPT,
      },
    })
  }
  let headers = new Headers(answer.headers)
  headers.delete(KEEP)
  headers.set(BROWSER, answer.headers.get('cache-control') ?? '')
  // Removed uploads stop serving after this keep, including during an outage.
  headers.set('cache-control', upload ? FRESH : KEPT)
  headers.set(TAGS, tags)
  return new Response(answer.body, { status: answer.status, headers })
}

// ── The apex's listings, at Site ───────────────────────────────────────────

/** Where Site keeps one of the apex's own pages. The hostname is a
 * placeholder for a service binding; the apex is in the path because the
 * cache keys by path and entrypoint, not the request hostname. */
/// listingAt('yaks.app', '/gallery') -> 'https://site.invalid/yaks.app/gallery'
export let listingAt = (apex: string, path: string): string =>
  `https://site.invalid/${encodeURIComponent(apex)}${path}`

/** Whether a visit to the sign-in card is a stranger's with nowhere to return
 * to: no session cookie and no credentials, so nobody is signed in to be sent
 * on, and no `return` the card would carry forward. Such a card is the same
 * for everyone, so Site keeps it. */
export let stranger = (req: Request): boolean =>
  !cookieValue(req.headers.get('cookie')) &&
  !req.headers.has('authorization') &&
  !new URL(req.url).searchParams.has('return')
