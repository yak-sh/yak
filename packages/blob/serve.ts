// A stored object as an HTTP response. Its bytes are content addressed, while
// its media type and name can change when the row is edited. A cache must
// revalidate that representation. Because what was stored may be an HTML page
// or an SVG, the response is fenced — a sandbox
// content security policy with no scripts, plus nosniff — so opening it
// directly in a tab displays it and runs nothing. The name, when there is one,
// goes in an inline `content-disposition`, encoded for HTTP headers.
//
// `Response` is the web platform's own, so this loads anywhere the package
// does.
import type { Opened } from './object.ts'

/** What the response needs to know about the object besides its bytes. */
export type Served = {
  mime?: string | null
  name?: string | null
  etag?: string | null
  cache?: 'immutable' | 'revalidate' | 'private'
}

// A server may ignore malformed or multiple ranges and answer the whole file.
// A well-formed single range that cannot name a byte gets a 416 instead.
let span = (said: string | null, size: number) => {
  if (!said) return null
  let match = /^bytes=(\d*)-(\d*)$/.exec(said.trim())
  if (!match || (!match[1] && !match[2])) return null
  let a = Number(match[1]), b = Number(match[2])
  if (
    (!match[1] && (!Number.isSafeInteger(b) || b <= 0)) ||
    (match[1] && !Number.isSafeInteger(a)) ||
    (match[2] && !Number.isSafeInteger(b))
  ) return false
  if (!size) return false
  let from = match[1] ? a : Math.max(0, size - b)
  let to = match[1] && match[2] ? Math.min(b, size - 1) : size - 1
  return from >= size || to < from ? false : { from, to }
}

let unchanged = (request: Request, etag: string | null) =>
  etag && ['GET', 'HEAD'].includes(request.method) &&
  (request.headers.get('if-none-match') ?? '').split(',').some((value) =>
    value.trim() == '*' ||
    value.trim().replace(/^W\//, '') == etag.replace(/^W\//, '')
  )

let plan = (size: number, request: Request, headers: HeadersInit) => {
  let head = new Headers(headers)
  head.set('accept-ranges', 'bytes')
  let etag = head.get('etag')
  if (unchanged(request, etag)) return { status: 304, head }
  let ifRange = request.headers.get('if-range')
  let match = request.method == 'GET' &&
    (!ifRange || (etag && !etag.startsWith('W/') && ifRange == etag))
  let range = match ? span(request.headers.get('range'), size) : null
  if (range === false) {
    head.set('content-range', `bytes */${size}`)
    head.set('content-length', '0')
    return { status: 416, head }
  }
  if (range) {
    head.set('content-range', `bytes ${range.from}-${range.to}/${size}`)
    head.set('content-length', String(range.to - range.from + 1))
    return { status: 206, head, range }
  }
  head.set('content-length', String(size))
  return { status: 200, head }
}

/** Answer one byte range with the same headers as the whole byte response. */
export let ranged = (
  bytes: Uint8Array,
  request: Request,
  headers: HeadersInit = {},
): Response => {
  let { status, head, range } = plan(bytes.byteLength, request, headers)
  if (status == 304 || status == 416) {
    return new Response(null, { status, headers: head })
  }
  let body = range ? bytes.subarray(range.from, range.to + 1) : bytes
  // Deno.serve replaces Content-Length with 0 for a null HEAD body. The
  // runtime omits this body on the wire while retaining the GET length.
  return new Response(body as Uint8Array<ArrayBuffer>, {
    status,
    headers: head,
  })
}

/** Serve a stored object without reading bytes before range selection. */
export let rangedOpen = async (
  object: Opened,
  request: Request,
  headers: HeadersInit = {},
): Promise<Response> => {
  let { status, head, range } = plan(object.size, request, headers)
  if (status == 304 || status == 416) {
    return new Response(null, { status, headers: head })
  }
  // Deno.serve rewrites Content-Length to zero for a null HEAD body. An
  // empty stream preserves the object's length without fetching its bytes.
  let body = request.method == 'HEAD'
    ? new ReadableStream({
      start(controller) {
        controller.close()
      },
    })
    : await object.read(range)
  return new Response(body, { status, headers: head })
}

// The address names only bytes; a validator also names the metadata that
// shapes the HTTP response. It changes when a re-upload corrects a media type
// or a name, so If-Range cannot join slices from two representations.
export let validator = async (
  sha: string,
  meta: Served,
): Promise<string> => {
  let bytes = new TextEncoder().encode(JSON.stringify([meta.mime, meta.name]))
  let digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let tag = [...digest.slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  return `"${sha}-${tag}"`
}

let disposition = (name: string) => {
  // deno-lint-ignore no-control-regex
  let clean = name.replace(/[\x00-\x1f\x7f"\\]/g, '')
  let ascii = clean.replace(/[^\x20-\x7e]/g, '_')
  let encoded = encodeURIComponent(clean.toWellFormed())
    .replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    )
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/** The bytes as a fenced HTTP response. */
let headersOf = (meta: Served): HeadersInit => ({
  'content-type': meta.mime || 'application/octet-stream',
  'cache-control': meta.cache == 'immutable'
    ? 'public, max-age=31536000, immutable'
    : meta.cache == 'revalidate'
    ? 'private, no-cache'
    : meta.cache == 'private'
    ? 'private, no-store'
    : 'public, no-cache',
  // A sandbox makes Chrome's native media viewer an opaque origin. Its
  // crossorigin fetch of this same URL then fails. Inert media keeps its
  // origin; document formats remain sandboxed.
  'content-security-policy': /^(audio|video)\//.test(meta.mime ?? '')
    ? "script-src 'none'"
    : "sandbox; script-src 'none'",
  'x-content-type-options': 'nosniff',
  ...(meta.etag ? { etag: meta.etag } : {}),
  ...meta.name
    ? {
      'content-disposition': disposition(meta.name),
    }
    : {},
})

export let served = (
  bytes: Uint8Array,
  meta: Served = {},
  request: Request = new Request('https://blob.invalid/'),
): Response => ranged(bytes, request, headersOf(meta))

export let servedOpen = (
  object: Opened,
  meta: Served = {},
  request: Request = new Request('https://blob.invalid/'),
): Promise<Response> => rangedOpen(object, request, headersOf(meta))

/** Fence a byte response fetched through a cache or another object store. */
export let servedVia = async (
  read: (request: Request) => Promise<Response>,
  meta: Served,
  request: Request,
): Promise<Response> => {
  let headers = new Headers(headersOf(meta))
  headers.set('accept-ranges', 'bytes')
  if (unchanged(request, headers.get('etag'))) {
    return new Response(null, { status: 304, headers })
  }
  let ifRange = request.headers.get('if-range')
  let range = request.method == 'GET' &&
      (!ifRange || (meta.etag && !meta.etag.startsWith('W/') &&
        ifRange == meta.etag))
    ? request.headers.get('range')
    : null
  let bytes = await read(
    new Request(request.url, {
      method: request.method,
      headers: range ? { range } : {},
    }),
  )
  if (![200, 206, 416].includes(bytes.status)) return bytes
  let head = new Headers(bytes.headers)
  for (let [key, value] of headers) head.set(key, value)
  head.delete('cache-tag')
  if (request.method == 'HEAD') await bytes.body?.cancel()
  return new Response(
    request.method == 'HEAD'
      ? new ReadableStream({ start: (c) => c.close() })
      : bytes.status == 416
      ? null
      : bytes.body,
    { status: bytes.status, headers: head },
  )
}
