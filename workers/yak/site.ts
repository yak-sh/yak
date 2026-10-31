import { anonymousPage, copyOf, publicDirectory } from './directory-copy.ts'
// The pages the Site entrypoint keeps in Cloudflare's cache (wrangler.toml):
// the apex's pages drawn from directory listings (the gallery and the
// integration directory for at most thirty seconds, the home page fresh for
// thirty and answered stale while it renders again), and every public page an
// app serves (page-cache.ts), keyed by the address it answers. The uncached gateway sends only canonical,
// uncredentialed requests here.
import { edged } from './apps.ts'
import { KEPT, kept, visitor } from './page-cache.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import * as gallery from './gallery.ts'
import { INTEGRATIONS, page as integrations } from './integrations.ts'
import { apex, type Host, url } from './host.ts'
import { lost } from './pages.ts'
import { matches } from './public-cache.ts'
import { clock, timed } from './timing.ts'

let FRESH = 'public, max-age=30, must-revalidate'
let uncached = (page: Response) => {
  let headers = new Headers(page.headers)
  headers.set('cache-control', 'private, no-store')
  return new Response(page.body, { status: page.status, headers })
}

// The hostname is a placeholder for a service binding; the apex is in the
// path because Workers Caching keys by path and entrypoint,
// not the request hostname.
export let at = (env: Host, path: string) =>
  `https://site.invalid/${encodeURIComponent(apex(env))}${path}`

// The gateway's anonymous subrequest carries validators and deploy selection,
// never browser credentials. HEAD uses that same GET and drops only its body.
export let forward = async (req: Request, env: Env, path: string) => {
  // A deploy probe selects a version at the gateway and at its cached Site
  // entrypoint. Without the override here the body can come from the previous
  // deployment even while the gateway runs the requested version.
  let headers = new Headers()
  for (
    let name of [
      'if-none-match',
      'cache-control',
      'Cloudflare-Workers-Version-Overrides',
    ]
  ) {
    let value = req.headers.get(name)
    if (value) headers.set(name, value)
  }
  let anonymous = anonymousPage(req)
  if (!anonymous) headers.set('x-yak-no-copy', '1')
  let shown =
    await (anonymous
      ? bound(env.SITE, fetch, env)
      : bound(undefined, fetch, env)).fetch(
        new Request(at(env, path), { headers }),
      )
  // A hit carries the old render's timing, not work done for this view, and
  // the home page's lifetime is its edge's: a browser still revalidates it.
  let hit = ['HIT', 'UPDATING', 'STALE'].includes(
    shown.headers.get('cf-cache-status') ?? '',
  )
  if (hit || shown.headers.get('cache-control') == KEPT) {
    shown = new Response(shown.body, shown)
    if (hit) shown.headers.delete('server-timing')
    if (shown.headers.get('cache-control') == KEPT) {
      shown.headers.set('cache-control', FRESH)
    }
  }
  if (req.method == 'GET') {
    return shown
  }
  await shown.body?.cancel()
  return new Response(null, { status: shown.status, headers: shown.headers })
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
  let serving = publicDirectory(
    bound(env.DIRECTORY, dirPart.fetch, env),
    req.headers.has('x-yak-no-copy') ? undefined : copyOf(env),
    env.CLOCK,
  )
  let dir = directory(serving)
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
  if ('stale' in serving && serving.stale) {
    c.include('copied;dur=1')
    return timed(uncached(page), c, 'site_')
  }
  return timed(await validated(req, page, env, path), c, 'site_')
}

// Validators include the deployment even when two releases render equal bytes.
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
  // edge answers from the page it holds and renders the next behind them. The
  // gallery and integrations stay short: a person looks there for their listing.
  headers.set('cache-control', path == '/' ? KEPT : FRESH)
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
