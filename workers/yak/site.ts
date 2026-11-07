import { copyOf } from './directory-copy.ts'
// The pages the Site entrypoint keeps in Cloudflare's cache (wrangler.toml):
// the apex's pages drawn from directory listings (the gallery and the
// integration directory and the home page fresh for thirty seconds, then
// answered stale while they render again), the app pictures those listings
// show (gallery.ts `image`), each app's visitor counts (views.ts `counted`),
// and every public page an
// app serves (page-cache.ts), keyed by the address it answers. The uncached gateway sends only canonical,
// uncredentialed requests here.
import { edged } from './apps.ts'
import {
  isListing,
  isStatic,
  KEPT,
  listing,
  listingAt,
  LOGIN,
  shareable,
  visitor,
} from './kept-page.ts'
import { kept } from './page-cache.ts'
import { r2Objects } from './lib/objects.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import * as docs from './docs.ts'
import * as gallery from './gallery.ts'
import { INTEGRATIONS, page as integrations } from './integrations.ts'
import { apex, type Host, hosted, url } from './host.ts'
import { askEmail, lost } from './pages.ts'
import { matches } from './public-cache.ts'
import { cardTag, SITE_TAG } from './purge.ts'
import { named, sheeted } from './sheets.ts'
import { priceAt } from './sell.ts'
import { type Clock, clock, timed } from './timing.ts'
import { COUNTED, counted } from './views.ts'
import { textable } from './phones.ts'
import { OPERATOR, PATHS } from './variant.ts'

let uncached = (page: Response) => {
  let headers = new Headers(page.headers)
  headers.set('cache-control', 'private, no-store')
  return new Response(page.body, { status: page.status, headers })
}

export let at = (env: Host, path: string) => listingAt(apex(env), path)

// The gateway's anonymous subrequest; a credentialed request renders in-process
// and takes no copied listing.
export let forward = (req: Request, env: Env, path: string) => {
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

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let asked = req.method == 'GET' ? visitor(req.url) : null
  if (asked) {
    let page = await edged(asked, env)
    let copied = page.headers.has('x-yak-directory-copy')
    page.headers.delete('x-yak-directory-copy')
    let answer = await kept(page)
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
 * static pages it keeps (kept-page.ts `isStatic`). */
export let statics = async (
  req: Request,
  env: Env,
  path: string,
  dir: dirPart.Directory,
): Promise<Response> => {
  // Before the assets, which serve the same markdown as files at those pages'
  // `.md` addresses — the whole rule (T-37793).
  let read = await docs.answer(req, env, path)
  if (read) return read
  // A page's bytes are this file's with the head's links swapped (sheets.ts), so
  // the file's etag says nothing about them: `worn` below answers for a page.
  let page = await env.ASSETS.fetch(
    /\.\w+$/.test(path) ? req : unconditional(req),
  )
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
      () => statics(new Request(url(env, path)), env, path, dir),
    )
  } else {
    // A home page variant (variant.ts): its own file, with the showcase.
    let file = await c.time(
      'assets',
      async () =>
        env.ASSETS.fetch(new Request(url(env, await drawn(env, path)))),
    )
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
  if (dir.stale) {
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
  headers.set('cache-tag', SITE_TAG)
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
