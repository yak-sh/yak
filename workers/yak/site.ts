import { copyOf } from './directory-copy.ts'
// The pages the Site entrypoint keeps in Cloudflare's cache (wrangler.toml):
// the apex's pages drawn from directory listings (the gallery and the
// integration directory and the home page fresh for thirty seconds, then
// answered stale while they render again), the app pictures those listings
// show (gallery.ts `image`), each app's visitor counts (views.ts `counted`),
// and every public page an
// app serves (page-cache.ts), keyed by the address it answers. The uncached gateway sends only canonical,
// uncredentialed requests here.
import { edged, editing } from './apps.ts'
import {
  homed,
  isListing,
  isStatic,
  KEEP,
  KEPT,
  listing,
  listingAt,
  LOGIN,
  NOW,
  personal,
  SEEN,
  shareable,
  STATICS,
  visitor,
} from './kept-page.ts'
import { kept, passed } from './page-cache.ts'
import { caught } from './defects.ts'
import {
  aim,
  API_AT,
  foreign,
  handedOff,
  hostOf,
  ready,
} from '@yaks/platform/routes'
import { COOKIE, cookieValue } from '@yaks/platform/cookie'
import { r2Objects } from './lib/objects.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import * as docs from './docs.ts'
import * as gallery from './gallery.ts'
import { INTEGRATIONS, page as integrations, rating } from './integrations.ts'
import { apex, type Host, hosted, url } from '@yaks/platform/host'
import { lost } from './pages.ts'
import { askEmail } from './signin-pages.ts'
import { matches } from './public-cache.ts'
import { cardTag, hostTag, SITE_TAG } from './purge.ts'
import { named, sheeted } from './sheets.ts'
import { priceAt } from './sell.ts'
import { type Clock, clock, timed } from './timing.ts'
import { COUNTED, counted } from './views.ts'
import { textable } from './phones.ts'
import { OPERATOR, PATHS } from './variant.ts'

// Said between the gateway's serving and Site (`fromHome`), never a browser's.
let COPIED = 'x-yak-directory-copy'

let uncached = (page: Response) => {
  let headers = new Headers(page.headers)
  for (let name of [KEEP, SEEN, COPIED]) headers.delete(name)
  headers.set('cache-control', 'private, no-store')
  return new Response(page.body, { status: page.status, headers })
}

export let at = (env: Host, path: string) => listingAt(apex(env), path)

// The gateway's anonymous subrequest; a credentialed request renders in-process
// and takes no copied listing, and so does a page of the home app for a person
// who may write it (`theirs`).
export let forward = async (req: Request, env: Env, path: string) => {
  if (homed(path) && await editing(req, env, HOME)) {
    return theirs(req, env, path)
  }
  let anonymous = shareable(req)
  return listing(
    req,
    anonymous ? bound(env.SITE, fetch, env) : bound(undefined, fetch, env),
    apex(env),
    path,
    !anonymous,
  )
}

let checksum = async (body: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(body),
      ),
    ),
  ].map((byte) => byte.toString(16).padStart(2, '0')).join('')

// A page at a custom domain's own address, as Site serves it (yak-front keys
// it by the hostname the browser asked, front.ts `kept`): the domain read as
// the gateway reads it (kernel.ts `settling`, `forwarded`, `aimed`), its
// request carried to its place's own address, and what it keeps tagged with
// the domain beside its app and space, so attaching, detaching or moving the
// domain takes it out (facets/pages-graph.ts). A domain that isn't serving
// its place, sends its visitors on or is nobody's is the gateway's: a pass.
let atDomain = async (asked: Request, env: Env, host: string) => {
  let at = await directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    time: env.CLOCK,
    public: true,
  }).serves(host)
  if (
    !at || !ready(at) || at.host.to ||
    handedOff(host, new URL(asked.url).pathname, env)
  ) {
    return passed()
  }
  let page = await edged(aim(asked, host, at, env), env)
  let tags = page.headers.get(KEEP)
  if (tags) page.headers.set(KEEP, `${tags},${hostTag(at.host.eid)}`)
  return page
}

/** yaks.app's own pages (site/mod.ts): the app `home` in the platform's own
 * space, answering at the apex the way an app answers at a custom domain's
 * root, carried to its own address and mounted at `/` (@yaks/platform/routes
 * `aim`). So its page wears the platform's scripts, whose doors are the
 * apex's own (its reporter's `/api/report` is page-report.ts), and the copy
 * its release holds. */
export let HOME = { space: { slug: 'yak' }, app: { slug: 'home' } }

/** Where the home app's own `api/` is at the apex, the address it has on its
 * space's hostname: its pages are mounted at `/`, where `/api/` is the
 * apex's (apex.ts), so the pencil's doors are here (@yaks/platform/routes
 * `API_AT`), carried to the app as any `<space>.yaks.app/<app>/api/` is. */
export let HOME_API = `/${HOME.app.slug}/`

// A page of the home app for a person who may write it (apps.ts `editing`),
// rendered here around the app's page as they are served it, which wears the
// pencil (`fromHome`), and never kept.
let theirs = (req: Request, env: Env, path: string) =>
  listing(
    req,
    bound(undefined, (asked: Request) => {
      let c = clock()
      return c.counting(() => rendered(asked, env, path, c, req))
    }, env),
    apex(env),
    path,
    true,
  )

// The home app's page at `path` as anyone is served it, with the tags a
// release of it purges (`KEEP`), or none where it has none to give: the
// platform's own space holds no `home` yet (a 404 that names no app, as on
// a box or staging with no such app), a release of it is under way (a pass
// for now, `NOW`), or anything else, which is a failure. A `visitor` who may
// write it is served it as themselves, by their session alone (as Site
// serves a session's own key, kept-page.ts `visitor`), and it is theirs:
// never kept.
let fromHome = async (
  env: Env,
  path: string,
  dir: dirPart.Directory,
  visitor?: Request,
) => {
  let session = visitor && cookieValue(visitor.headers.get('cookie'))
  let headers = new Headers({ [API_AT]: HOME_API })
  if (session) headers.set('cookie', `${COOKIE}=${session}`)
  let page = await edged(
    aim(new Request(url(env, path), { headers }), apex(env), HOME, env),
    env,
    dir,
  )
  let seen = JSON.parse(page.headers.get(SEEN) ?? '{}') as { app?: string }
  if (page.status == 200 && page.headers.has(KEEP)) {
    // The browser's own reports are an app's door's (apps.ts `reporting`);
    // the apex's takes the reporter's alone (page-report.ts).
    for (let name of [SEEN, 'nel', 'reporting-endpoints']) {
      page.headers.delete(name)
    }
    return { page: session ? uncached(page) : page }
  }
  await page.body?.cancel()
  let absent = page.status == 404 && !seen.app
  if (!absent && !page.headers.has(NOW)) {
    caught(new Error(`the home app answered ${page.status} for ${path}`), {
      request: 'home page',
    })
  }
  return { page: null, kept: absent }
}

/** A page of the site: the home app's, else this deploy's own file
 * (site/mod.ts `deployed`), which answers until the app does and whenever it
 * can't, kept only where the app has none. */
let sitePage = async (
  env: Env,
  path: string,
  req: Request,
  dir: dirPart.Directory,
  visitor?: Request,
) => {
  let home = await fromHome(env, path, dir, visitor)
  if (home.page) return home.page
  let file = await env.ASSETS.fetch(req)
  return home.kept ? file : uncached(file)
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let asked = req.method == 'GET' ? visitor(req.url, req) : null
  if (asked) {
    let host = hostOf(asked, env)
    let page = foreign(host, env)
      ? await atDomain(asked, env, host)
      : await edged(asked, env)
    let copied = page.headers.has(COPIED)
    page.headers.delete(COPIED)
    let answer = await kept(page, personal(req.url))
    return copied ? uncached(answer) : answer
  }
  let root = `/${encodeURIComponent(apex(env))}`
  let path = new URL(req.url).pathname
  if (req.method == 'GET' && path.startsWith(COUNTED)) return counted(env, path)
  if (
    req.method != 'GET' || !isListing(path.slice(root.length)) ||
    !path.startsWith(`${root}/`)
  ) return uncached(lost(env))
  path = path.slice(root.length)
  let c = clock()
  // Every round trip and bucket read it makes lands on its own count, which
  // Server-Timing reports as `site_hops` and `site_r2`.
  return c.counting(() => rendered(req, env, path, c))
}

// The file a variant is drawn from. The Operator's page asks for a number,
// and until a code can be texted to one (phones.ts `textable`) its other
// drawing asks for an email.
export let drawn = async (env: Env, path: string) =>
  path == OPERATOR && !await textable(env) ? `${OPERATOR}-email` : path

let unconditional = (req: Request) => {
  let headers = new Headers(req.headers)
  headers.delete('if-none-match')
  return new Request(req, { headers })
}

/** An apex path no door of the kernel's claims: the guide's pages (docs.ts,
 * T-37752) and the 301s the addresses it moved from answer, else this
 * deploy's files. The kernel answers every such path with it, and Site the
 * static pages it keeps (kept-page.ts `isStatic`), or a `visitor` who may
 * write the home app their own (`theirs`). */
export let statics = async (
  req: Request,
  env: Env,
  path: string,
  dir: dirPart.Directory,
  visitor?: Request,
): Promise<Response> => {
  // Before the assets, which serve the same markdown as files at those pages'
  // `.md` addresses — the whole rule (T-37793).
  let read = await docs.answer(req, env, path)
  if (read) return read
  // A page's bytes are this file's with the head's links swapped (sheets.ts), so
  // the file's etag says nothing about them: `worn` below answers for a page.
  let page = STATICS.includes(path)
    ? await sitePage(env, path, unconditional(req), dir, visitor)
    : await env.ASSETS.fetch(/\.\w+$/.test(path) ? req : unconditional(req))
  if (page.status == 404) {
    // A page held from before a deploy names the sheet that deploy replaced.
    let was = named(path)
    return was ? Response.redirect(url(env, was), 302) : lost(env)
  }
  let type = page.headers.get('content-type')?.split(';')[0].trim() ?? ''
  if (
    apex(env) != apex() && page.status == 200 && page.body &&
    ['text/html', 'text/plain', 'text/markdown', 'text/x-markdown'].includes(
      type,
    )
  ) {
    let headers = new Headers(page.headers)
    headers.delete('content-length')
    headers.delete('etag')
    page = new Response(hosted(await page.text(), env), {
      status: page.status,
      headers,
    })
  }
  // Setup is also served on space hosts, where the download attribute alone
  // cannot download this cross-origin icon.
  if (path == '/yaks-app.png') {
    let headers = new Headers(page.headers)
    headers.set('content-disposition', 'attachment; filename="yaks-app.png"')
    return new Response(page.body, { status: page.status, headers })
  }
  // Pricing is the other static page with a dynamic splice.
  if (path == '/pricing') page = await priceAt(dir, page)
  return type == 'text/html' && page.status == 200
    ? await worn(req, page, env)
    : page
}

let rendered = async (
  req: Request,
  env: Env,
  path: string,
  c: Clock,
  visitor?: Request,
): Promise<Response> => {
  let dir = directory(
    bound(env.DIRECTORY, dirPart.fetch, env),
    {
      copy: req.headers.has('x-yak-no-copy') ? undefined : copyOf(env),
      time: env.CLOCK,
      public: true,
    },
  )
  let page: Response
  if (path.startsWith(gallery.IMAGE)) {
    page = await c.time(
      'image',
      () => gallery.image(dir, r2Objects(env.BLOBS), path, env),
    )
  } else if (path == '/gallery') {
    let listed = await c.time('listed', () => gallery.listed(dir, env))
    page = gallery.page(gallery.pictures(listed, env), env)
  } else if (path == INTEGRATIONS.path) {
    page = await c.time('listed', () => dir.integrations())
      .then((all) => rating(dir, all))
      .then((all) => integrations(all, env))
  } else if (path == LOGIN) {
    // The card identity.ts shows someone not signed in, with nowhere to go back.
    page = await c.time(
      'login',
      async () => askEmail({ texts: await textable(env) }, env),
    )
  } else if (isStatic(path)) {
    page = await c.time(
      'static',
      () => statics(new Request(url(env, path)), env, path, dir, visitor),
    )
  } else {
    // A home page variant (variant.ts): its own file, with the showcase.
    let file = await c.time('page', async () => {
      let at = await drawn(env, path)
      return sitePage(env, at, new Request(url(env, at)), dir, visitor)
    })
    page = file.status == 404
      ? lost(env)
      : await c.time('showcase', () => gallery.made(env, dir, file))
  }
  // A picture's address may answer where its picture is (gallery.ts `CARD`).
  if (
    ![200, 302].includes(page.status) || page.headers.has('set-cookie') ||
    page.headers.get('cache-control')?.includes('no-store')
  ) {
    return timed(uncached(page), c, 'site_')
  }
  if (dir.stale || page.headers.has(COPIED)) {
    c.include('copied;dur=1')
    return timed(uncached(page), c, 'site_')
  }
  if (path.startsWith(gallery.IMAGE)) {
    return timed(pictured(req, page, path), c, 'site_')
  }
  return timed(await validated(req, page, env, path), c, 'site_')
}

// A picture's bytes are its sha's, so its etag is the sha: kept like the
// listing that shows it, and purged with it. So is a card's redirect, which a
// release of its app purges too, since its files say where it points.
let pictured = (req: Request, page: Response, path: string) => {
  let headers = new Headers(page.headers)
  let [eid, sha] = path.slice(gallery.IMAGE.length).split('/')
  headers.set('cache-control', KEPT)
  headers.set(
    'cache-tag',
    [SITE_TAG, ...sha == gallery.CARD ? [cardTag(eid)] : []].join(','),
  )
  return matches(req.headers.get('if-none-match'), headers.get('etag') ?? '')
    ? new Response(null, { status: 304, headers })
    : new Response(page.body, { status: page.status, headers })
}

// Validators include the deployment even when two releases render equal bytes.
// A static page as it leaves: its head's links swapped, and validated by the
// bytes it answers with.
export let worn = async (req: Request, page: Response, env: Host) => {
  let headers = new Headers(page.headers)
  headers.delete('content-length')
  // A HEAD has no bytes here to name; only a GET's etag means anything.
  headers.delete('etag')
  if (req.method == 'HEAD') return new Response(null, { headers })
  let body = sheeted(await page.text(), env)
  headers.set('etag', `W/"${await checksum(body)}"`)
  return matches(req.headers.get('if-none-match'), headers.get('etag') ?? '')
    ? new Response(null, { status: 304, headers })
    : new Response(body, { headers })
}

export let validated = async (
  req: Request,
  page: Response,
  env: Pick<Env, 'CF_VERSION_METADATA'>,
  path: string,
): Promise<Response> => {
  let body = await page.text()
  let headers = new Headers(page.headers)
  headers.delete('content-length')
  // No deploy or quiet hour makes a visitor wait on the home page's render: the
  // edge answers from the page it holds and renders the next behind them. A
  // listing change purges these pages through the directory's usual hook.
  headers.set('cache-control', KEPT)
  // A page the home app served is purged by its releases too (`fromHome`).
  headers.set(
    'cache-tag',
    [SITE_TAG, ...headers.get(KEEP)?.split(',') ?? []].join(','),
  )
  headers.delete(KEEP)
  if (PATHS.includes(path) && env.CF_VERSION_METADATA) {
    headers.set('x-yak-version', env.CF_VERSION_METADATA.id)
  }
  // A revalidation must replace deployment metadata even when the page's
  // rendered bytes are identical across deployments.
  headers.set(
    'etag',
    `W/"${await checksum(
      JSON.stringify([headers.get('x-yak-version'), body]),
    )}"`,
  )
  return matches(req.headers.get('if-none-match'), headers.get('etag') ?? '')
    ? new Response(null, { status: 304, headers })
    : new Response(body, { headers })
}
