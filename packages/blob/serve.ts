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

/** What the response needs to know about the object besides its bytes. */
export type Served = {
  mime?: string | null
  name?: string | null
  etag?: string | null
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

/** Answer one byte range with the same headers as the whole byte response. */
export let ranged = (
  bytes: Uint8Array,
  request: Request,
  headers: HeadersInit = {},
): Response => {
  let head = new Headers(headers)
  head.set('accept-ranges', 'bytes')
  let etag = head.get('etag')
  if (unchanged(request, etag)) {
    return new Response(null, { status: 304, headers: head })
  }
  let ifRange = request.headers.get('if-range')
  let match = request.method == 'GET' &&
    (!ifRange || (etag && !etag.startsWith('W/') && ifRange == etag))
  let range = match
    ? span(request.headers.get('range'), bytes.byteLength)
    : null
  if (range === false) {
    head.set('content-range', `bytes */${bytes.byteLength}`)
    head.set('content-length', '0')
    return new Response(null, { status: 416, headers: head })
  }
  if (range) {
    head.set(
      'content-range',
      `bytes ${range.from}-${range.to}/${bytes.byteLength}`,
    )
    let part = bytes.subarray(range.from, range.to + 1)
    head.set('content-length', String(part.byteLength))
    return new Response(part as Uint8Array<ArrayBuffer>, {
      status: 206,
      headers: head,
    })
  }
  head.set('content-length', String(bytes.byteLength))
  // Deno.serve replaces Content-Length with 0 for a null HEAD body. The
  // runtime omits this body on the wire while retaining the GET length.
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: head })
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
export let served = (
  bytes: Uint8Array,
  meta: Served = {},
  request: Request = new Request('https://blob.invalid/'),
): Response =>
  ranged(bytes, request, {
    'content-type': meta.mime || 'application/octet-stream',
    'cache-control': 'public, no-cache',
    'content-security-policy': "sandbox; script-src 'none'",
    'x-content-type-options': 'nosniff',
    ...(meta.etag ? { etag: meta.etag } : {}),
    ...meta.name
      ? {
        'content-disposition': disposition(meta.name),
      }
      : {},
  })
