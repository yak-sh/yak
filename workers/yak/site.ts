import { copyOf } from './directory-copy.ts'
// The pages the Site entrypoint keeps in Cloudflare's cache (wrangler.toml):
// the apex's pages drawn from directory listings (the gallery and the
// integration directory and the home page fresh for thirty seconds, then
// answered stale while they render again), and every public page an
// app serves (page-cache.ts), keyed by the address it answers. The uncached gateway sends only canonical,
// uncredentialed requests here.
import { edged } from './apps.ts'
import { KEPT, listing, listingAt, shareable, visitor } from './kept-page.ts'
import { kept } from './page-cache.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import * as gallery from './gallery.ts'
import { INTEGRATIONS, page as integrations } from './integrations.ts'
import { apex, type Host, url } from './host.ts'
import { lost } from './pages.ts'
import { matches } from './public-cache.ts'
import { SITE_TAG } from './purge.ts'
import { sheeted } from './sheets.ts'
import { clock, timed } from './timing.ts'

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
  if (
    req.method != 'GET' ||
    !['/', '/gallery', INTEGRATIONS.path].includes(path.slice(root.length)) ||
    !path.startsWith(`${root}/`)
  ) return uncached(lost(env))
  path = path.slice(root.length)
  let c = clock()
  let dir = directory(
    bound(env.DIRECTORY, dirPart.fetch, env),
    {
      copy: req.headers.has('x-yak-no-copy') ? undefined : copyOf(env),
      time: env.CLOCK,
      public: true,
    },
  )
  let page: Response
  if (path == '/gallery') {
    page = gallery.page(
      await gallery.pictures(env, await gallery.listed(dir, env)),
      env,
    )
  } else if (path == INTEGRATIONS.path) {
    page = await integrations(await dir.integrations(), env)
  } else {
    let file = await c.time(
      'assets',
      () => env.ASSETS.fetch(new Request(url(env, '/'))),
    )
    page = file.status == 404
      ? lost(env)
      : await c.time('showcase', () => gallery.made(env, dir, file))
  }
  if (
    page.status != 200 || page.headers.has('set-cookie') ||
    page.headers.get('cache-control')?.includes('no-store')
  ) {
    return timed(uncached(page), c, 'site_')
  }
  if (dir.stale) {
    c.include('copied;dur=1')
    return timed(uncached(page), c, 'site_')
  }
  return timed(await validated(req, page, env, path), c, 'site_')
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
  if (path == '/' && env.CF_VERSION_METADATA) {
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
