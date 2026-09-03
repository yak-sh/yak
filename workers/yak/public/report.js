// The reporter every page gets, whether or not it asked: the kernel injects
// this script into each HTML page it serves for an app (apps.ts), so a break
// in the browser reaches the same place a break on the server does — an
// `exception` entity in the app's store, on the agent's next reply
// (D-32318 §Errors are surfaced). No opt-in, nothing for a page to import.
//
// Four things break in a browser and none of them throw where anyone sees
// it: a script error, a file that never loaded, a promise nobody caught, and
// a call to the app's own doors that came back a no. The first three are
// events; the last is a thin wrapper around `fetch` that watches same-origin
// /api/ answers and passes everything through untouched. A no the door MEANT
// — sign in to change this app — is not a break, and the door drops those
// (apps.ts, unseen.ts `refusal`); this script reports what it saw and judges
// none of it.
//
// A file that never loaded is the one that hurts most: an installed copy's
// module 404'd, the page painted a heading and empty space, and nobody was
// told (C-32905 items 2 and 8). That failure fires ON the element and does
// not bubble, so the listener below is in the CAPTURE phase, where one
// handler sees both a script that threw and a script, link or image — or a
// module graph — that never arrived.
//
// And when a break leaves the person looking at nothing, the page says so:
// the soft state of D-32318 §Errors, in the home page's voice, once, and
// never over a page that painted.
//
// The door is beside this file (./report next to ./report.js), read from
// this script's own src so a page at any depth reports to its own app. A
// beacon carries it, because a page that is dying is a page that will not
// wait for a response; the door itself is rate-limited per app.

let door = new URL('report', document.currentScript.src).href
let sent = 0

let send = (body) => {
  // A render loop that throws every frame must not become a write loop.
  if (sent++ >= 20) return
  try {
    let blob = new Blob([JSON.stringify(body)], { type: 'application/json' })
    if (!navigator.sendBeacon || !navigator.sendBeacon(door, blob)) {
      fetch(door, { method: 'POST', body: blob, keepalive: true })
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
// THREW targets the window instead, and has an `error` of its own.
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

addEventListener('unhandledrejection', (e) => {
  broke({
    message: `unhandled rejection: ${said(e.reason)}`,
    stack: e.reason && e.reason.stack,
    url: location.href,
  })
})

let mine = (url) => url.origin == location.origin && url.href != door

let plain = globalThis.fetch
globalThis.fetch = async (input, init) => {
  let where = new URL((input && input.url) || input, location.href)
  try {
    let r = await plain(input, init)
    if (!r.ok && mine(where)) {
      let why = await r.clone().text().catch(() => '')
      send({
        message: `${r.status} ${where.pathname}: ${why}`.slice(0, 2000),
        url: location.href,
        // The answer as it came, so the door can tell a no it MEANT — a
        // signed-out visitor sent to sign in — from one it did not
        // (unseen.ts `refusal`). This script decides nothing: it is cached
        // in browsers we cannot reach, and the rule lives where we can.
        status: r.status,
        answer: why.slice(0, 2000),
      })
      // The one thing this script does read the status FOR: whether to draw
      // over the page. A no somebody meant is the platform working and never
      // becomes a sorry line; a 5xx is nobody's choice.
      if (r.status >= 500) sorry()
    }
    return r
  } catch (e) {
    if (mine(where)) {
      broke({ message: `${where.pathname}: ${said(e)}`, url: location.href })
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
let SORRY = 'Something went wrong. Your assistant has been told.'

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
          ? 'background:#2a2320;color:#f1e6d8'
          : 'background:#fdf5ee;color:#4a3a30')
      ;(document.body || document.documentElement).append(box)
    } catch { /* a reporter that throws is worse than one that misses */ }
  })
}
