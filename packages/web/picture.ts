/**
 * A kept page: what a page looked like when its person last saw it, drawn
 * at once when they open it again, before the network answers, and replaced
 * by the page itself as soon as it does.
 *
 * A **snapshot** is a page's document as the person last saw it, taken by
 * the page (`@yaks/web/keep`): what showed and a screen either side of it, and
 * the rules of its sheets that it uses. A **picture** is a snapshot made safe to
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

/** The attribute on a part of a page that moves by itself, an animation: its
 * motion is no change worth keeping the page again for (@yaks/web/keep), and
 * a picture shows it as it stood when taken. */
export let MOVES = 'data-kept-moves'

/** The attribute on each of two parts of a page that take turns, one shown
 * and the other inert behind it (Home and its signed-in view,
 * @yaks/web/ready): while inert, it is no part of a picture, and its changes
 * are no change. */
export let TURNS = 'data-kept-turns'

/** The header the bootstrap's fetch carries, which a service worker may
 * answer with the page it already asked the network for (`@yaks/web/worker`). */
export let FRESH = 'x-yak-fresh'
export let FRESH_WAIT = 'x-yak-fresh-wait'
export let FRESH_URL = 'x-yak-fresh-url'

/** What a picture's bootstrap sends its worker to have the next open of its
 * page come from the network (`@yaks/web/worker`). */
export let NETWORK = 'network'

/** When to show that a picture is waiting on a slow page, and how long the
 * page written over it may take to finish parsing. */
export let LATE = 6_000
export let WRITTEN = 8_000

/** What a picture's bootstrap says, beside the open timing (`opening`): the
 * door it reports a picture that fell back to (@yaks/tracker/report). */
export type Boot = { opening?: string; door?: string }

// The bootstrap, written as the script it runs, since a bundler's helpers
// would not come along with a function's own text. It asks for the page as
// it is now, and writes it over the picture once both are in. A picture
// that cannot be had offline stays, marked as kept. Any other way it cannot
// be replaced (an answer that is no page, a throw, a shell offline) reports
// why and loads the page from the network, once. While the original request
// is still running, the person can keep waiting or ask to reload.
let boot = ({ opening, door }: Boot = {}) =>
  `(() => {
  let opened = null
  try { opened = ${opening ?? 'null'} } catch {}
  let began = performance.now()
  let root = document.documentElement
  let shell = root.hasAttribute('${SHELL}')
  let stage
  let step = (now) => {
    stage = now
    try { opened?.step?.(now) } catch {}
  }
  step('asked')
  let settled = false
  let door = ${JSON.stringify(door ?? null)}
  let tell = (why) => {
    if (!door) return
    try {
      let body = JSON.stringify({
        message: 'A kept ' + (shell ? 'shell' : 'picture') + ' fell back to the network: ' + why,
        stack: location.href + ' (kept ' + (shell ? 'shell' : 'picture') + ', ' + stage + ')',
        page: location.href,
        mechanism: 'catch',
      })
      if (!navigator.sendBeacon?.(door, new Blob([body], { type: 'application/json' }))) {
        fetch(door, { method: 'POST', body, keepalive: true }).catch(() => {})
      }
    } catch {}
  }
  let reload = () => {
    let gone = false
    let again = () => gone || (gone = true, location.reload())
    let worker = navigator.serviceWorker?.controller
    if (!worker) return again()
    let line = new MessageChannel()
    line.port1.onmessage = again
    worker.postMessage({ '${NETWORK}': location.href }, [line.port2])
    setTimeout(again, 1000)
  }
  let network = (why) => {
    if (settled) return
    settled = true
    clearTimeout(late)
    tell(why)
    reload()
  }
  let status = () => document.querySelector('[data-kept-status]')
  let late = setTimeout(() => {
    let said = status()
    if (settled || !said) return
    let again = document.createElement('button')
    again.type = 'button'
    again.textContent = 'Reload'
    again.style.pointerEvents = 'auto'
    again.onclick = () => network('reload requested while ' + stage)
    said.replaceChildren('This is taking longer than usual. ', again)
  }, ${LATE})
  let offline = () => {
    if (shell) return network('offline')
    settled = true
    clearTimeout(late)
    opened?.offline()
    let at = new Date(Number(root.getAttribute('${KEPT}')))
    let said = status()
    if (said) said.textContent = 'Offline. This is how it looked at ' +
      at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.'
  }
  fetch(location.href, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'text/html', '${FRESH}': '1' },
  }).then((r) => {
    step('read')
    let wait = r.headers.get('${FRESH_WAIT}')
    // The server's own time on it, beside the wait (Server-Timing).
    let gateway = /(?:^|,)\\s*gateway;dur=([\\d.]+)/.exec(r.headers.get('server-timing') || '')
    try {
      opened?.waited(wait == null ? performance.now() - began : Number(wait),
        gateway ? Number(gateway[1]) : undefined)
    } catch {}
    if (!r.ok || !(r.headers.get('content-type') || '').includes('text/html')) {
      return network('answered ' + r.status)
    }
    return r.text().then(async (html) => {
      let url = r.headers.get('${FRESH_URL}') || r.url
      if (!html.trim()) return network('answered with an empty page')
      // What the page waits on before it can paint, its sheets and the
      // scripts its head runs in order, asked for first, so the picture stays
      // until the page can take its place, never a blank page between.
      step('files')
      let head = html.slice(0, html.search(/<body[\\s>]/i))
      let held = [...head.matchAll(/<(link|script)\\b[^>]*>/gi)]
        .map(([tag]) => tag)
        .filter((tag) => /rel=["']?stylesheet/i.test(tag) ||
          (/^<script/i.test(tag) && !/\\b(type=["']?module|defer|async)\\b/i.test(tag)))
        .map((tag) => /\\b(?:href|src)=["']?([^"' >]+)/i.exec(tag)?.[1])
        .filter(Boolean)
        .map((at) => new URL(at, url || location.href))
        .filter((at) => at.origin == location.origin)
      await Promise.all(held.map(async (at) => {
        let file = await fetch(at.href)
        if (!file.ok) {
          await file.body?.cancel()
          throw new Error('A file the page needs answered ' + file.status + ' at ' + at.pathname)
        }
        await file.blob()
      }))
      if (settled) return
      if (url && url != location.href) {
        history.replaceState(history.state, '', url)
      }
      step('parsed')
      if (document.readyState == 'loading') {
        await new Promise((ready) =>
          document.addEventListener('DOMContentLoaded', ready, { once: true }))
      }
      // The open timing's frame, but never longer than a second of it.
      step('frame')
      if (document.visibilityState != 'hidden' && opened?.frame) {
        await Promise.race([opened.frame, new Promise((on) => setTimeout(on, 1000))])
      }
      if (settled) return
      step('written')
      try { opened?.swapping() } catch {}
      document.open()
      document.write(html)
      document.close()
      settled = true
      clearTimeout(late)
      // The page written over the picture finishes parsing, or comes again
      // from the network.
      setTimeout(() => {
        if (document.readyState != 'loading') return
        tell('written page still loading after ${WRITTEN} ms')
        reload()
      }, ${WRITTEN})
    })
  }, (e) => {
    if (navigator.onLine === false) offline()
    else network('request failed: ' + ((e && e.message) || e))
  }).catch((e) => network('threw ' + ((e && e.message) || e)))
})()`
export let BOOT: string = boot()

// What a picture says while the page is asked for, over everything.
let status = (said: string) =>
  `<p role="status" data-kept-status style="position:fixed;z-index:2147483647;top:calc(env(safe-area-inset-top) + 8px);left:50%;transform:translateX(-50%);margin:0;padding:4px 12px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font:13px/1.5 system-ui,sans-serif;pointer-events:none">${said}</p>`

// A script, whole: what it says is most of a page's bytes (the rows it was
// drawn from, its own code), and none of it runs in a picture.
let SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi
let AHEAD = /<link\b[^>]*\brel=(["'])(?:modulepreload|prefetch)\1[^>]*>/gi
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
  { shell = false, ...said }: Boot & { shell?: boolean } = {},
): string =>
  snapshot
    .replace(SCRIPT, '')
    .replace(AHEAD, '')
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
      (head) => `${head}<script>${boot(said)}</script>`,
    )
