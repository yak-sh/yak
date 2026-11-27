/**
 * What a site's page shows while it opens, and when opening fails: drawn by
 * a style and script inline in the page's head, before any file the page
 * asks for, so they work when none of its files do.
 *
 * - The page wears the site's background from its first frame, before its
 *   stylesheet is in, and the sheet's own once it is.
 * - A page still arriving that has painted nothing 300 ms after its head did
 *   shows the site's mark on its background with a quiet bar, gone once the
 *   page is in. A fast open never shows it.
 * - One that has painted nothing after 4 s says it is taking longer than
 *   usual and offers Try again, where the browser can paint it.
 * - Both leave by themselves once the page is in whole, parsed with every
 *   stylesheet: the page that came, however late, is never covered. A slow
 *   open is reported by its open timing (@yaks/timing).
 * - A site can retry an open once after a visible window finishes loading
 *   and still paints nothing. It reports the failure and shows a recovery
 *   screen. A page still waiting on its server or files keeps waiting.
 * - A script or stylesheet of the site's own that fails before the page has
 *   loaded says the page could not open, over the page where it drew
 *   nothing, else in a line at its foot, and offers Try again. Its reporter
 *   files the failure; this files it only where the reporter itself never
 *   ran.
 * - A page a service worker draws for an open it could not get (`failure`)
 *   says why at once: offline, the site unreachable, or a server error the
 *   site did not draw, which it reports.
 *
 * Try again forgets every kept page (./worker.ts) and loads the page again
 * from the network. Nothing is reported from a browser driven by a script
 * or a visit marked as a check.
 *
 * @module
 */
import { FORGOT, PAGES } from './worker.ts'

/** A site's look while its pages open: its name as a person reads it, its
 * background and ink in the light and dark schemes, the address of its mark,
 * and the door it reports breaks to (@yaks/tracker/report). */
export type Opening = {
  name: string
  background: string
  ink: string
  dark: { background: string; ink: string }
  mark: string
  report: string
  retryBlank?: boolean
}

/** Why a page could not be opened, as a service worker found it: the
 * browser is offline, the site could not be reached, or it answered an error
 * page it did not draw, which `said` says. */
export type Failure = {
  state: 'offline' | 'unreachable' | 'failed'
  said: string
}

/** The attribute on the head's style, by which a page that wears it is
 * known. */
export let OPENING = 'data-yak-opening'

// After how long, in milliseconds, a page that has painted nothing shows it
// is opening, and says it is slow.
let CUE = 300
let SLOW = 4000

// The body's background is in the first layer a page names, below every
// other: the page's own sheet, once in, says it instead. The screen's rules
// are in no layer, above every layer a sheet names.
let style = (o: Opening) => {
  let scheme = (c: { background: string; ink: string }) =>
    `@layer yak-opening{body{background:${c.background}}}.YakOpening{background:${c.background};color:${c.ink}}.YakOpening button{background:${c.ink};color:${c.background}}`
  return `<style ${OPENING}>${scheme(o)}@media (prefers-color-scheme:dark){${
    scheme(o.dark)
  }}.YakOpening{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;margin:0;padding:2rem;text-align:center;font:600 1.05rem/1.5 Nunito,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;animation:YakOpening .2s}.YakOpening img{width:88px;height:88px;border-radius:20px}.YakOpening p{margin:0;max-width:22rem}.YakOpening p+p{font-weight:400;opacity:.8}.YakOpening button{font:inherit;margin-top:.5rem;padding:.6rem 1.5rem;border:0;border-radius:999px;cursor:pointer}.YakOpening_Bar{width:5rem;height:4px;border-radius:2px;background:currentColor;animation:YakOpeningBar 1.2s ease-in-out infinite}.YakOpening[data-state=line]{inset:auto 0 0;flex-direction:row;flex-wrap:wrap;gap:.25rem 1rem;padding:.75rem 1rem calc(.75rem + env(safe-area-inset-bottom));font-size:.95rem;box-shadow:0 -1px 4px #0003}.YakOpening[data-state=line] button{margin:0;padding:.35rem 1rem}@keyframes YakOpening{from{opacity:0}}@keyframes YakOpeningBar{0%,100%{opacity:.15}50%{opacity:.5}}@media (prefers-reduced-motion:reduce){.YakOpening,.YakOpening_Bar{animation:none;opacity:1}.YakOpening_Bar{opacity:.3}}</style>`
}

// The script, called with the site's opening and the cache and entry
// Try again keeps apart from what it forgets.
let SCRIPT = `(o, pages, forgot) => {
  if (top != self || window[Symbol.for('yaks.opening')]) return
  window[Symbol.for('yaks.opening')] = true
  let root = document.documentElement
  let early = Symbol.for('yaks.early-report')
  let checked = navigator.webdriver ||
    new URLSearchParams(location.search).get('utm_source') == 'agent-check'
  let parsed = () => document.readyState != 'loading'
  let timing = window.PerformanceObserver?.supportedEntryTypes?.includes('paint')
  let painted = () => !!performance.getEntriesByName('first-contentful-paint').length
  let SAY = {
    loading: [],
    slow: [o.name + ' is taking longer than usual to open this page.', 'It will show as soon as it arrives.'],
    failed: [o.name + " couldn't open this page.", 'It has been reported.'],
    offline: ["You're offline, and this page isn't saved on this device.", 'Connect to the internet, then try again.'],
    unreachable: [o.name + " couldn't be reached.", 'Check your connection, then try again.'],
    line: ["Part of this page didn't load, so it may not work."],
  }
  let reported = false
  let report = (message) => {
    if (reported || checked) return
    reported = true
    try {
      let body = JSON.stringify({ message, stack: 'Error: ' + message + '\\n    at ' + location.href, page: location.href, mechanism: 'onerror' })
      if (!navigator.sendBeacon?.(o.report, body)) {
        fetch(o.report, { method: 'POST', body, keepalive: true }).catch(() => {})
      }
    } catch {}
  }
  let again = async () => {
    try {
      let kept = await caches.open(pages)
      for (let r of await kept.keys()) {
        if (new URL(r.url).pathname != forgot) await kept.delete(r)
      }
    } catch {}
    location.reload()
  }
  let box, shown
  let draw = (state) => {
    if (shown == state) return
    shown = state
    document.getElementById('yak-sorry')?.remove()
    box?.remove()
    box = document.createElement('div')
    box.className = 'YakOpening'
    box.dataset.state = state
    box.setAttribute('role', state == 'loading' ? 'progressbar' : 'alert')
    if (state == 'loading') box.setAttribute('aria-label', 'Opening ' + o.name)
    if (state != 'line') {
      let mark = document.createElement('img')
      mark.src = o.mark
      mark.alt = ''
      mark.onerror = () => mark.remove()
      box.append(mark)
    }
    for (let words of SAY[state]) {
      let p = document.createElement('p')
      p.textContent = words
      box.append(p)
    }
    if (state == 'loading') {
      let bar = document.createElement('span')
      bar.className = 'YakOpening_Bar'
      box.append(bar)
    } else {
      let button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Try again'
      button.onclick = again
      box.append(button)
    }
    ;(document.body || root).append(box)
  }
  let given = root.getAttribute('${OPENING}')
  if (given) {
    draw(given)
    if (given == 'failed' || given == 'unreachable') {
      report(root.getAttribute('${OPENING}-said') || 'The page could not be opened')
    }
    return
  }
  // Painted nothing yet, so far as the browser can say.
  let blank = () => timing ? !painted() : !parsed()
  // The page in whole: parsed, and every stylesheet in. A loading or slow
  // screen leaves then, by itself, so it never stands over a page that came,
  // however late.
  let whole = () => parsed() && [...document.querySelectorAll('link[rel=stylesheet]')].every((l) => l.sheet)
  let settle = () => {
    if (!whole()) return
    clearTimeout(cue)
    clearTimeout(slow)
    if (shown == 'loading' || shown == 'slow') {
      box.remove()
      box = shown = undefined
    }
  }
  let cue = setTimeout(() => { if (!whole() && blank()) draw('loading') }, ${CUE})
  let slow = setTimeout(() => {
    if (!whole() && (shown == 'loading' || blank())) draw('slow')
  }, ${SLOW})
  document.addEventListener('readystatechange', settle)
  // Each stylesheet as it comes in, and the page's own load.
  addEventListener('load', settle, true)
  // The site's own script or stylesheet that failed before the page loaded.
  let broke
  let ours = (at) => {
    try { return new URL(at, location.href).origin == location.origin } catch { return false }
  }
  let heard = (e) => {
    let t = e.target
    let file = t != window && (t?.tagName == 'SCRIPT' || t?.tagName == 'LINK' && t.rel == 'stylesheet')
      ? t.src || t.href
      : e.filename
    if (broke || !file || !ours(file)) return
    broke = t != window ? 'A file the page needs did not load: ' + file : (e.message || 'A script failed') + ' at ' + file
  }
  addEventListener('error', heard, true)
  // A blank document may have finished loading without running a needed
  // script. Start the deadline after load, so a slow server is never retried
  // automatically. Only the visible window can provide paint evidence.
  let retry = () => {
    if (!o.retryBlank || !timing || document.readyState != 'complete') return
    let key = 'yak-blank-retry'
    let at = location.pathname + location.search
    let watch
    let check = () => {
      clearTimeout(watch)
      if (document.visibilityState != 'visible') return
      watch = setTimeout(() => {
        document.removeEventListener('visibilitychange', check)
        let blank = !painted()
        let first = false
        try {
          let retried = sessionStorage.getItem(key) == at
          if (!blank && retried) sessionStorage.removeItem(key)
          if (blank && !retried) {
            sessionStorage.setItem(key, at)
            first = true
          }
        } catch {}
        if (!blank) return
        report('The page finished loading but painted nothing')
        draw('failed')
        if (first) void again()
      }, ${SLOW})
    }
    document.addEventListener('visibilitychange', check)
    check()
  }
  let judge = () => {
    document.removeEventListener('readystatechange', settle)
    removeEventListener('error', heard, true)
    removeEventListener('load', settle, true)
    retry()
    if (!broke) return
    let text = (document.body?.innerText || '').trim()
    let bare = text.length <= 80 && !document.body?.querySelector('img, canvas, svg, video, iframe')
    clearTimeout(slow)
    draw(bare ? 'failed' : 'line')
    if (window[early]) report(broke)
  }
  addEventListener('load', () => setTimeout(judge, 0), { once: true })
}`

// The script as every page carries it, without the indents that make it
// readable here.
let SAID = SCRIPT.replace(/\n\s+/g, '\n')

/** The style and script a page's head carries for `o`, before any file it
 * names. */
export let openingHead = (o: Opening): string =>
  `${style(o)}<script ${OPENING}>(${SAID})(${JSON.stringify(o)},${
    JSON.stringify(PAGES)
  },${JSON.stringify(FORGOT)})</script>`

let esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

let document = (o: Opening, attrs: string, head: string, body = ''): string =>
  `<!doctype html>
<html lang="en"${attrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="${o.background}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${o.dark.background}" media="(prefers-color-scheme: dark)">
<title>${esc(o.name)}</title>
${head}
</head>
<body>${body}</body>
</html>`

/** A site's shell for a page whose data is fetched afresh on every open. */
export let openingShell = (o: Opening): string =>
  document(
    o,
    '',
    style(o),
    `<main class="YakOpening" style="z-index:auto;animation:none"><p>${
      esc(o.name)
    }</p></main>`,
  )

/** The whole page a service worker answers an open it could not get with,
 * saying why at once (`Failure`). */
export let failurePage = (o: Opening, f: Failure): string =>
  document(
    o,
    ` ${OPENING}="${f.state}" ${OPENING}-said="${esc(f.said)}"`,
    openingHead(o),
  )
