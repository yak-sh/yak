// A stored object as an HTTP response. Content-addressed bytes can never change
// under their address, so they are cached indefinitely; and because what was
// stored may be an HTML page or an SVG, the response is fenced — a sandbox
// content security policy with no scripts, plus nosniff — so opening it
// directly in a tab displays it and runs nothing. The name, when there is one,
// goes in an inline `content-disposition`, with the characters that could break
// the header stripped out.
//
// `Response` is the web platform's own, so this loads anywhere the package
// does.

/** What the response needs to know about the object besides its bytes. */
export type Served = { mime?: string | null; name?: string | null }

/** The bytes as a fenced, immutably cached HTTP response. */
export let served = (bytes: Uint8Array, meta: Served = {}): Response =>
  new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      'content-type': meta.mime || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      'content-security-policy': "sandbox; script-src 'none'",
      'x-content-type-options': 'nosniff',
      ...meta.name
        ? {
          'content-disposition': `inline; filename="${
            meta.name.replace(/["\\\r\n]/g, '')
          }"`,
        }
        : {},
    },
  })
