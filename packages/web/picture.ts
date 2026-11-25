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
 * A **shell** is the picture of the frame a site's pages share, for an
 * address with no picture of its own: the last page left, with what is its
 * own (`OWN`: its title, its body) left empty. It is drawn the same way, and
 * replaced the same way.
 *
 * @module
 */

/** The attribute a picture's root wears, saying when it was taken. */
export let KEPT = 'data-kept'

/** The attribute on each part of a page that is its own, rather than the
 * frame it shares with the site's other pages: what a shell leaves empty. */
export let OWN = 'data-kept-own'

/** The attribute a shell's root wears beside `KEPT`. */
export let SHELL = 'data-kept-shell'

/** A pane's starting scroll position in a picture, in pixels or at its end. */
export let SCROLL = 'data-kept-scroll'

/** The header the bootstrap's fetch carries, which a service worker may
 * answer with the page it already asked the network for (`@yaks/web/worker`). */
export let FRESH = 'x-yak-fresh'
export let FRESH_WAIT = 'x-yak-fresh-wait'
export let FRESH_URL = 'x-yak-fresh-url'

// The bootstrap, written as the script it runs, since a bundler's helpers
// would not come along with a function's own text. It asks for the page as
// it is now, and writes it over the picture once both are in; a page that
// cannot be had says so, and the picture stays, marked as kept.
let boot = (opening = 'null') =>
  `(() => {
  let opened = ${opening}
  let began = performance.now()
  let status = () => document.querySelector('[data-kept-status]')
  let failed = () => {
    opened?.offline()
    let root = document.documentElement
    let at = new Date(Number(root.getAttribute('${KEPT}')))
    let said = status()
    if (said) said.textContent = root.hasAttribute('${SHELL}') ? 'Offline.'
      : 'Offline. This is how it looked at ' +
        at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.'
  }
  fetch(location.href, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'text/html', '${FRESH}': '1' },
  }).then((r) => {
    let wait = r.headers.get('${FRESH_WAIT}')
    opened?.waited(wait == null ? performance.now() - began : Number(wait))
    return r.ok && (r.headers.get('content-type') || '').includes('text/html')
      ? r.text().then((html) => ({ html, url: r.headers.get('${FRESH_URL}') || r.url }))
      : null
  }).then(async (page) => {
    if (!page) return failed()
    // What the page waits on before it can paint, its sheets and the
    // scripts its head runs in order, asked for first, so the picture stays
    // until the page can take its place, never a blank page between.
    let head = page.html.slice(0, page.html.search(/<body[\s>]/i))
    let held = [...head.matchAll(/<(link|script)\b[^>]*>/gi)]
      .map(([tag]) => tag)
      .filter((tag) => /rel=["']?stylesheet/i.test(tag) ||
        (/^<script/i.test(tag) && !/\b(type=["']?module|defer|async)\b/i.test(tag)))
      .map((tag) => /\b(?:href|src)=["']?([^"' >]+)/i.exec(tag)?.[1])
      .filter(Boolean)
    await Promise.all(held.map((at) => fetch(at).then((r) => r.blob(), () => {})))
    if (page.url && page.url != location.href) {
      history.replaceState(history.state, '', page.url)
    }
    if (document.readyState == 'loading') {
      await new Promise((ready) =>
        document.addEventListener('DOMContentLoaded', ready, { once: true }))
    }
    if (document.visibilityState != 'hidden') await opened?.frame
    opened?.swapping()
    document.open()
    document.write(page.html)
    document.close()
  }).catch(failed)
})()`
export let BOOT: string = boot()

// What a picture says while the page is asked for, over everything.
let status = (said: string) =>
  `<p role="status" data-kept-status style="position:fixed;z-index:2147483647;top:calc(env(safe-area-inset-top) + 8px);left:50%;transform:translateX(-50%);margin:0;padding:4px 12px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font:13px/1.5 system-ui,sans-serif;pointer-events:none">${said}</p>`

// A script, whole: what it says is most of a page's bytes (the rows it was
// drawn from, its own code), and none of it runs in a picture.
let SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi
let FRAME_SRC = /(<iframe\b[^>]*?\s)src(\s*=)/gi

// This runs at the end of the picture's markup. Its styles are in before
// this classic script reads the layout.
let SCROLLING = `(() => {
  let anchor
  try { anchor = document.getElementById(decodeURIComponent(location.hash.slice(1))) }
  catch { /* a malformed fragment names no target */ }
  if (anchor?.closest('[hidden]')) anchor = null
  for (let pane of document.querySelectorAll('[${SCROLL}]')) {
    if (anchor && pane.contains(anchor)) continue
    let at = pane.getAttribute('${SCROLL}')
    pane.scrollTop = at == 'end' ? pane.scrollHeight : Number(at) || 0
  }
  if (anchor?.id.startsWith('row-')) anchor.scrollIntoView({ block: 'center' })
})()`

/**
 * The picture of `snapshot`, taken at `at` (milliseconds since the epoch):
 * its scripts gone, its frames empty, its root marked kept, its status line
 * saying it is updating, and its bootstrap first in its head. A `shell`'s
 * root says so, and its status line that the page is opening.
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
export let picture = (
  snapshot: string,
  at: number,
  opening?: string,
  shell = false,
): string =>
  snapshot
    .replace(SCRIPT, '')
    .replace(FRAME_SRC, '$1data-kept-src$2')
    .replace(/<html\b/i, `<html ${KEPT}="${at}"${shell ? ` ${SHELL}` : ''}`)
    .replace(
      /<body\b[^>]*>/i,
      (body) => body + status(shell ? 'Opening…' : 'Updating…'),
    )
    .replace(
      /<\/body\s*>/i,
      (body) =>
        snapshot.includes(SCROLL)
          ? `<script>${SCROLLING}</script>${body}`
          : body,
    )
    .replace(
      /<head\b[^>]*>/i,
      (head) => `${head}<script>${boot(opening)}</script>`,
    )
