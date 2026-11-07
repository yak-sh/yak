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
  KEPT,
  listing,
  listingAt,
  shareable,
  visitor,
} from './kept-page.ts'
import { kept } from './page-cache.ts'
import { r2Objects } from './lib/objects.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import * as gallery from './gallery.ts'
import { INTEGRATIONS, page as integrations } from './integrations.ts'
import { apex, type Host, url } from './host.ts'
import { lost } from './pages.ts'
import { matches } from './public-cache.ts'
import { cardTag, SITE_TAG } from './purge.ts'
import { sheeted } from './sheets.ts'
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
