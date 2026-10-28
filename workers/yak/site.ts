import { anonymousPage, copyOf, publicDirectory } from './directory-copy.ts'
// The pages the Site entrypoint keeps in Cloudflare's cache (wrangler.toml):
// the apex's pages drawn from directory listings (the home page, the gallery
// and the integration directory), each for at most thirty
// seconds, and every public page an app serves (page-cache.ts), keyed by the
// address it answers. The uncached gateway sends only canonical,
// uncredentialed requests here.
import { edged } from './apps.ts'
import { kept, visitor } from './page-cache.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import * as gallery from './gallery.ts'
import { INTEGRATIONS, page as integrations } from './integrations.ts'
import { apex, type Host, url } from './host.ts'
import { lost } from './pages.ts'
import { matches } from './public-cache.ts'

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
    let file = await env.ASSETS.fetch(new Request(url(env, '/')))
    page = file.status == 404 ? lost(env) : await gallery.made(env, dir, file)
  }
  if (
    page.status != 200 || page.headers.has('set-cookie') ||
    page.headers.get('cache-control')?.includes('no-store')
  ) {
    return uncached(page)
  }
  if ('stale' in serving && serving.stale) return uncached(page)
  return validated(req, page, env, path)
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
  headers.set('cache-control', FRESH)
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
