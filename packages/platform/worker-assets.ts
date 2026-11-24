import { holding } from '@yaks/blob'
import { digest } from '@yaks/graph/sha256'
import { localAsset } from './asset-url.ts'
import { decoded, inside } from './files.ts'
import { browserImmutable, keptLong } from './kept.ts'
import { ADDRESS } from './routes.ts'
import { assetPath, releaseId } from './versions.ts'

let HASH = '__yak_asset'
let SUFFIX = new RegExp(`([?&])${HASH}=([0-9a-f]{64})$`)
let LIMIT = 1024 * 1024

/** A worker asset stays in its own folder, so CSS and SVG relative URLs
 * keep resolving from the original address. Existing query bytes are kept. */
let workerAssetUrl = (url: URL, sha: string): string =>
  `${url.pathname}${url.search}${
    url.search ? '&' : '?'
  }${HASH}=${sha}${url.hash}`

export let workerAssetQuery = (url: URL) => {
  let match = SUFFIX.exec(url.search)
  if (!match) return null
  let original = new URL(url)
  original.search = url.search.slice(0, match.index)
  return { sha: match[2], original }
}

type Kind = 'style' | 'image'

/** Only directly served styles and icons are fingerprinted. A response can
 * require revalidation or carry state that belongs to its original request. */
let workerAsset = async (page: Response) => {
  let type = page.headers.get('content-type')?.split(';')[0].trim()
    .toLowerCase()
  let cache = page.headers.get('cache-control') ?? ''
  if (
    page.status != 200 || !page.body ||
    (type != 'text/css' && !type?.startsWith('image/')) ||
    /\b(no-store|no-cache|max-age\s*=\s*"?0)\b/i.test(cache) ||
    [
      'set-cookie',
      'vary',
      'content-encoding',
      'content-disposition',
      'clear-site-data',
    ]
      .some((name) => page.headers.has(name))
  ) return { page, sha: null, type, long: false }
  let bytes = await holding({ stream: page.body }, LIMIT)
  if (!(bytes instanceof Uint8Array)) {
    return {
      page: new Response(bytes.stream, page),
      sha: null,
      type,
      long: false,
    }
  }
  return {
    page: new Response(bytes, page),
    sha: await digest(bytes),
    type,
    long: keptLong(cache),
  }
}

export let assetRequest = (req: Request, url: URL, address?: URL | null) => {
  let headers = new Headers(req.headers)
  for (let name of headers.keys().toArray()) {
    if (name.startsWith('if-') || name == 'range') headers.delete(name)
  }
  if (address) headers.set(ADDRESS, address.href)
  return new Request(url, { method: 'GET', headers, signal: req.signal })
}

/** Ask for the same representation as a subresource load at this mount. */
export let assetProbe = (req: Request, target: URL, kind: Kind) => {
  let visible = new URL(req.headers.get(ADDRESS) ?? req.url)
  let url = new URL(req.url)
  let prefix = url.pathname.slice(
    0,
    url.pathname.length - visible.pathname.length,
  )
  url.pathname = prefix + target.pathname
  url.search = target.search
  let sub = assetRequest(req, url, req.headers.has(ADDRESS) ? target : null)
  sub.headers.set('sec-fetch-dest', kind)
  sub.headers.set('sec-fetch-mode', 'no-cors')
  sub.headers.set('sec-fetch-site', 'same-origin')
  sub.headers.set(
    'accept',
    kind == 'style' ? 'text/css,*/*;q=0.1' : 'image/*,*/*;q=0.8',
  )
  for (let name of ['sec-fetch-user', 'referer', 'origin']) {
    sub.headers.delete(name)
  }
  return sub
}

type PageAssets = {
  at: string
  bare: string
  source: string | null | undefined
  base: string
  holds: (path: string) => boolean
  reserved: (path: string) => boolean
  probe: (url: URL, kind: Kind) => Promise<Response>
  failed: (error: unknown) => void
}

// An HTML file returned by env.FILES may name the release's fallback URL
// for a route that only the worker can answer.
let originalRef = (ref: string, { at, source, base, holds }: PageAssets) => {
  if (!URL.canParse(ref, base)) return ref
  let url = new URL(ref, base)
  if (
    url.origin != new URL(base).origin || !url.pathname.startsWith(`${at}api/`)
  ) {
    return ref
  }
  let old = assetPath(url.pathname.slice(`${at}api`.length))
  return old && old.release == releaseId(source) &&
      !holds(decoded(old.path.slice(1)) ?? '')
    ? `${at}${old.path.slice(1)}${url.search}${url.hash}`
    : ref
}

/** Resolve the styles and icons a worker's page links at its own routes.
 * Each distinct URL is asked once, with a bounded fan-out per document. */
export let generatedAt = (page: PageAssets) => {
  let { at, bare, reserved, base, probe, failed } = page
  let asked = new Map<string, Promise<string | null>>()
  return async (ref: string, kind: Kind) => {
    let found = localAsset(originalRef(ref, page), at, bare, reserved, base)
    if (!found || workerAssetQuery(found.url) || inside('/' + found.path)) {
      return ref
    }
    let url = new URL(found.url)
    url.hash = ''
    let key = `${kind} ${url.href}`
    let pending = asked.get(key)
    if (!pending && asked.size < 8) {
      pending = probe(url, kind).then(workerAsset).then(async (asset) => {
        await asset.page.body?.cancel()
        return !asset.long &&
            (kind == 'style'
              ? asset.type == 'text/css'
              : asset.type?.startsWith('image/'))
          ? asset.sha
          : null
      }).catch((error) => {
        failed(error)
        return null
      })
      asked.set(key, pending)
    }
    let sha = await pending
    return sha ? workerAssetUrl(found.url, sha) : ref
  }
}

/** A named request still goes through the app. The hash only authorizes
 * freshness, once the worker has served those exact bytes to this caller. */
export let namedWorkerAsset = async (
  req: Request,
  page: Response,
  { sha, original }: NonNullable<ReturnType<typeof workerAssetQuery>>,
) => {
  let found = await workerAsset(page)
  let headers = new Headers(found.page.headers)
  let matching = found.sha == sha
  headers.set(
    'cache-control',
    matching ? browserImmutable : 'private, no-store',
  )
  if (!matching && page.ok && page.status != 206) {
    await found.page.body?.cancel()
    let visible = new URL(req.headers.get(ADDRESS) ?? req.url)
    visible.search = original.search
    return new Response(null, {
      status: 307,
      headers: {
        location: visible.pathname.startsWith('//')
          ? visible.href
          : visible.pathname + visible.search,
        'cache-control': 'private, no-store',
      },
    })
  }
  if (matching) {
    headers.append('vary', 'Cookie, Authorization')
    headers.set('etag', `"${sha}"`)
  }
  let unchanged = matching &&
    (req.headers.get('if-none-match') ?? '').split(',')
      .some((tag) => ['*', `"${sha}"`].includes(tag.trim().replace(/^W\//, '')))
  let empty = unchanged || req.method == 'HEAD'
  if (empty) await found.page.body?.cancel()
  if (unchanged) headers.delete('content-length')
  return new Response(empty ? null : found.page.body, {
    status: unchanged ? 304 : found.page.status,
    statusText: unchanged ? '' : found.page.statusText,
    headers,
  })
}
