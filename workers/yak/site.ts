// The apex's two pages drawn from directory listings. The uncached gateway
// sends only their canonical, uncredentialed paths here; the Site entrypoint
// caches each rendered answer for at most thirty seconds (wrangler.toml).
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import * as gallery from './gallery.ts'
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
// path because Workers Caching keys by path, entrypoint and Worker version,
// not the request hostname.
export let at = (env: Host, path: string) =>
  `https://site.invalid/${encodeURIComponent(apex(env))}${path}`

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
  let root = `/${encodeURIComponent(apex(env))}`
  let path = new URL(req.url).pathname
  if (
    req.method != 'GET' ||
    !['/', '/gallery'].includes(path.slice(root.length)) ||
    !path.startsWith(`${root}/`)
  ) return uncached(lost(env))
  path = path.slice(root.length)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let page: Response
  if (path == '/gallery') {
    page = gallery.page(
      await gallery.pictures(env, await gallery.listed(dir, env)),
      env,
    )
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
  let body = await page.text()
  let headers = new Headers(page.headers)
  headers.delete('content-length')
  headers.set('etag', `W/"${await checksum(body)}"`)
  headers.set('cache-control', FRESH)
  if (path == '/' && env.CF_VERSION_METADATA) {
    headers.set('x-yak-version', env.CF_VERSION_METADATA.id)
  }
  return matches(req.headers.get('if-none-match'), headers.get('etag') ?? '')
    ? new Response(null, { status: 304, headers })
    : new Response(body, { headers })
}
