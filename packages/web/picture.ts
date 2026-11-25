/**
 * A kept page: what a page looked like when its person last saw it, drawn
 * at once when they open it again, before the network answers, and replaced
 * by the page itself as soon as it does.
 *
 * A **snapshot** is a page's whole document as the person last saw it, taken
 * by the page (`@yaks/web/keep`). A **picture** is a snapshot made safe to
 * show again (`picture`): it has no scripts, and its frames are empty, so no
 * code from the release that drew it starts, and it says it is kept: `data-kept` on
 * its root and a status line, never passing for the page as it is now. The
 * one script it runs is its bootstrap (`BOOT`), which fetches the page as it
 * is now and writes it over the picture in place. Its scripts then run once,
 * as on any load.
 *
 * @module
 */

/** The attribute a picture's root wears, saying when it was taken. */
export let KEPT = 'data-kept'

/** The header the bootstrap's fetch carries, which a service worker may
 * answer with the page it already asked the network for (`@yaks/web/worker`). */
export let FRESH = 'x-yak-fresh'

// The bootstrap, written as the script it runs, since a bundler's helpers
// would not come along with a function's own text. It asks for the page as
// it is now, and writes it over the picture once both are in; a page that
// cannot be had says so, and the picture stays, marked as kept.
export let BOOT = `(() => {
  let status = () => document.querySelector('[data-kept-status]')
  let failed = () => {
    let at = new Date(Number(document.documentElement.getAttribute('${KEPT}')))
    let said = status()
    if (said) said.textContent = 'Offline. This is how it looked at ' +
      at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.'
  }
  fetch(location.href, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'text/html', '${FRESH}': '1' },
  }).then((r) =>
    r.ok && (r.headers.get('content-type') || '').includes('text/html')
      ? r.text().then((html) => ({ html, url: r.url }))
      : null
  ).then((page) => {
    if (!page) return failed()
    let write = () => {
      if (page.url && page.url != location.href) {
        history.replaceState(history.state, '', page.url)
      }
      document.open()
      document.write(page.html)
      document.close()
    }
    if (document.readyState == 'loading') {
      document.addEventListener('DOMContentLoaded', write, { once: true })
    } else write()
  }, failed)
})()`

// What a picture says while the page is asked for, over everything.
let STATUS =
  '<p role="status" data-kept-status style="position:fixed;z-index:2147483647;top:calc(env(safe-area-inset-top) + 8px);left:50%;transform:translateX(-50%);margin:0;padding:4px 12px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font:13px/1.5 system-ui,sans-serif;pointer-events:none">Updating…</p>'

// A script, whole: what it says is most of a page's bytes (the rows it was
// drawn from, its own code), and none of it runs in a picture.
let SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi
let FRAME_SRC = /(<iframe\b[^>]*?\s)src(\s*=)/gi

/**
 * The picture of `snapshot`, taken at `at` (milliseconds since the epoch):
 * its scripts gone, its frames empty, its root marked kept, its status line
 * saying it is updating, and its bootstrap first in its head.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let kept = picture(
 *   '<!doctype html><html lang="en"><head><script type="module" src="/a.js"></script></head>' +
 *     '<body class="Shell"><iframe src="/app/"></iframe><script>go()</script></body></html>',
 *   1700000000000,
 * )
 * assertEquals(kept.includes('<html data-kept="1700000000000" lang="en">'), true)
 * assertEquals(kept.includes('/a.js') || kept.includes('go()'), false)
 * assertEquals(kept.includes('<iframe data-kept-src="/app/">'), true)
 * assertEquals(kept.includes('<body class="Shell"><p role="status" data-kept-status'), true)
 * assertEquals(kept.indexOf('<script>(() =>') > kept.indexOf('<head>'), true)
 * ```
 */
export let picture = (snapshot: string, at: number): string =>
  snapshot
    .replace(SCRIPT, '')
    .replace(FRAME_SRC, '$1data-kept-src$2')
    .replace(/<html\b/i, `<html ${KEPT}="${at}"`)
    .replace(/<head\b[^>]*>/i, (head) => `${head}<script>${BOOT}</script>`)
    .replace(/<body\b[^>]*>/i, (body) => body + STATUS)
