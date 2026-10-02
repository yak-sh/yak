// Browser capture and the empty-page fallback, served as a classic script.
// The platform retains its existing report door until T-59077 switches intake.

let script = document.currentScript
let door = new URL('report', script.src).href
// Keep the version this page loaded, even after another release is served.
let version = Number(script.dataset.version)
let sent = 0
let crumbs = []
let crumb = (category, message) => {
  crumbs.push({ at: new Date().toISOString(), category, message })
  crumbs = crumbs.slice(-20)
}
crumb('navigation', location.pathname)
addEventListener('popstate', () => crumb('navigation', location.pathname))
addEventListener('hashchange', () => crumb('navigation', location.pathname))

let send = (body) => {
  // A render loop that throws every frame must not become a write loop.
  if (sent++ >= 20) return
  try {
    let blob = new Blob([
      JSON.stringify({ ...body, version, breadcrumbs: crumbs }),
    ], {
      type: 'application/json',
    })
    // A beacon always sends credentials, and a sandboxed app's page — an
    // opaque origin, `self.origin` "null" — reports to a door that answers
    // any origin only because it takes none (installed.ts), so the browser
    // refuses the beacon. A keepalive fetch sends none from there.
    let beacon = self.origin != 'null' && navigator.sendBeacon
    if (!beacon || !navigator.sendBeacon(door, blob)) {
      Promise.resolve(
        fetch(door, { method: 'POST', body: blob, keepalive: true }),
      ).catch(() => {})
    }
  } catch { /* a reporter that throws is worse than one that misses */ }
}

let said = (e) => (e && e.message) || String(e)

// A break, and the page's own account of it: everything that goes through
// here is something nobody chose, so it may also draw the soft state.
let broke = (body) => {
  send(body)
  sorry()
}

// The element a resource error happened on, if that is what this was: a
// script, link, img, or the module graph one of them pulled. A script that
// threw targets the window instead, and has an `error` of its own.
// On the app's own origin, and not this script's door: what happened there
// is the app's, and what happened on somebody else's server is not ours to
// file — a script on another origin may have 404'd, or been blocked by the
// visitor, or been put in the page by the edge, and from here those are one
// event. The test is the origin and not a list of hostnames, which would rot
// the first time the platform injected something new. The reporter itself
// needs no line of its own: a script that never loaded never listens.
let mine = (url) => url.origin == location.origin && url.href != door

// A failed graph query needs its filter to be diagnosable. Other API query
// strings may carry credentials or an outbound URL, so their path is enough.
let asked = (url) =>
  url.pathname +
  (url.pathname.endsWith('/api/query') ? url.search : '')

// Where a src points, or nothing if the browser handed us something that is
// not an address: a reporter that throws is worse than one that misses.
let at = (url) => {
  try {
    return new URL(url, document.baseURI)
  } catch {
    return null
  }
}

let missed = (e) =>
  e.target && e.target != globalThis && e.target.tagName && !e.error
    ? e.target
    : null

addEventListener('error', (e) => {
  let el = missed(e)
  if (el) {
    // The address that 404'd is the news — the page is dead for the want of
    // it — so it is both what this says and where it says it happened.
    let src = el.src || el.href || ''
    let where = at(src)
    // Off the app's origin is not the app's file: the analytics beacon the
    // edge injects, blocked in the visitor's browser, is the platform's news
    // and not this app's (T-32487).
    if (where && !mine(where)) return
    return broke({
      message: `failed to load ${el.tagName.toLowerCase()}${
        src ? ` ${src}` : ''
      }`,
      url: src || location.href,
    })
  }
  broke({
    message: said(e.error) || e.message,
    stack: e.error && e.error.stack,
    url: e.filename || location.href,
    line: e.lineno,
  })
}, true)

// A refusal from ./api/client.js that the page never caught carries the
// answer's status, and goes to the door as the fetch below sends it: the door
// judges a no somebody meant, and only a break draws over the page.
addEventListener('unhandledrejection', (e) => {
  let status = e.reason && e.reason.status
  ;(status < 500 ? send : broke)({
    message: `unhandled rejection: ${said(e.reason)}`,
    stack: e.reason && e.reason.stack,
    url: location.href,
    status,
  })
})

let consoleError = globalThis.console?.error
if (consoleError) {
  globalThis.console.error = (...args) => {
    // Console arguments can carry user data; only the first sentence is kept.
    let message = said(args[0]).slice(0, 2000)
    crumb('console', message)
    send({ message, url: location.href, mechanism: 'console' })
    consoleError.apply(console, args)
  }
}

let plain = globalThis.fetch
globalThis.fetch = async (input, init) => {
  // Against the page's base, not its address: the kernel gives every page a
  // `<base>` at the app's own root (apps.ts `based`), so that is what the
  // browser resolved `./api/query` against — resolving it against
  // `location.href` here would name a path nothing was ever asked for.
  let where = new URL((input && input.url) || input, document.baseURI)
  try {
    let r = await plain(input, init)
    if (mine(where) && where.pathname.includes('/api/')) {
      crumb('fetch', `${r.status} ${where.pathname}`)
    }
    if (!r.ok && mine(where)) {
      let why = await r.clone().text().catch(() => '')
      send({
        message: `${r.status} ${asked(where)}: ${why}`.slice(0, 2000),
        url: location.href,
        // The answer as it came, so the door can tell a no it meant — a
        // signed-out visitor sent to sign in — from one it did not
        // (unseen.ts `refusal`). This script decides nothing: it is cached
        // in browsers we cannot reach, and the rule lives where we can.
        status: r.status,
        answer: why.slice(0, 2000),
      })
      // The one thing this script does read the status for: whether to draw
      // over the page. A no somebody meant is the platform working and never
      // becomes a sorry line; a 5xx is nobody's choice.
      if (r.status >= 500) sorry()
    }
    return r
  } catch (e) {
    if (mine(where)) {
      broke({ message: `${asked(where)}: ${said(e)}`, url: location.href })
    }
    throw e
  }
}

// The soft state, in D-32318 §Errors' own words: "The app's page shows a soft
// 'something went wrong, your assistant has been told' state rather than a
// stack trace."
//
// Only when the break left the person with nothing to look at. "Painted" is
// judged the honest, cheap way — the body's own words, and whether anything
// that draws pixels is in it — because the page that sent the ninth user test
// away was a heading and empty space (C-32905 item 2), which every paint
// timing in the browser calls a paint. A shell is under a line of text and
// has no picture in it; a page doing its job has one or the other.
let SHELL = 80
let bare = () => {
  let b = document.body
  if (!b) return true
  if ((b.innerText || '').trim().length > SHELL) return false
  return !b.querySelector('img, canvas, svg, video, iframe')
}

// Judged after the page has had its chance: a module that 404s reports before
// anything could have painted, so the answer waits for `load` — or two
// seconds, since a page that never finishes loading never fires it.
let settled = (draw) => {
  let t
  let now = () => {
    clearTimeout(t)
    removeEventListener('load', now)
    draw()
  }
  if (document.readyState == 'complete') return setTimeout(now, 0)
  t = setTimeout(now, 2000)
  addEventListener('load', now)
}

// The home page's own colors (public/style.css): warm linen and warm brown,
// cocoa in the dark, never black. Set through CSSOM rather than a <style>
// element, so an app with its own strict CSP still shows it.
let SORRY = 'Something went wrong. Try reloading the page.'

let dark = () =>
  globalThis.matchMedia &&
  matchMedia('(prefers-color-scheme: dark)').matches

let told = false

let sorry = () => {
  if (told) return
  told = true
  settled(() => {
    if (!bare()) return
    try {
      let box = document.createElement('div')
      box.id = 'yak-sorry'
      box.setAttribute('role', 'status')
      box.textContent = SORRY
      box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;' +
        'display:flex;align-items:center;justify-content:center;' +
        'margin:0;padding:2rem;text-align:center;' +
        "font:600 1.05rem/1.6 'Nunito',system-ui,-apple-system,'Segoe UI'," +
        'Roboto,sans-serif;' +
        (dark()
          ? 'background:#2b231f;color:#f1e6d8'
          : 'background:#fdf7ee;color:#523828')
      ;(document.body || document.documentElement).append(box)
    } catch { /* a reporter that throws is worse than one that misses */ }
  })
}
