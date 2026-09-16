// A stored object as an HTTP answer. Content-addressed bytes can never change
// under their address, so they cache forever; and because what was stored may
// be an HTML page or an SVG, the answer is fenced — a sandbox CSP with no
// scripts, and nosniff — so opening it directly in a tab shows it and runs
// nothing. The name, when there is one, rides as an inline disposition with
// the characters that could break the header stripped out.
//
// `Response` is the web platform's, so this loads anywhere the package does.

/** What an answer needs to know about the object besides its bytes. */
export type Served = { mime?: string | null; name?: string | null }

/** The bytes as a fenced, immutable HTTP response. */
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
