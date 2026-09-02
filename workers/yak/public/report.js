// The reporter every page gets, whether or not it asked: the kernel injects
// this script into each HTML page it serves for an app (apps.ts), so a break
// in the browser reaches the same place a break on the server does — an
// `exception` entity in the app's store, on the agent's next reply
// (D-32318 §Errors are surfaced). No opt-in, nothing for a page to import.
//
// Three things break in a browser and none of them throw where anyone sees
// it: a script error, a promise nobody caught, and a call to the app's own
// doors that came back a refusal. The first two are events; the third is a
// thin wrapper around `fetch` that watches same-origin /api/ answers and
// passes everything through untouched.
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

addEventListener('error', (e) => {
  send({
    message: said(e.error) || e.message,
    stack: e.error && e.error.stack,
    url: e.filename || location.href,
    line: e.lineno,
  })
})

addEventListener('unhandledrejection', (e) => {
  send({
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
      })
    }
    return r
  } catch (e) {
    if (mine(where)) {
      send({ message: `${where.pathname}: ${said(e)}`, url: location.href })
    }
    throw e
  }
}
