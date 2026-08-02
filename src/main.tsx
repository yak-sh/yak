import { render } from 'preact'
import { agreementProbe, boot, cache, clientId, config, ent } from './live.ts'
import { idOf } from './types.ts'
import { route } from './components/nav.tsx'
import { App } from './components/App.tsx'

// Tell the server when this page breaks (the rows land in telemetry) — a
// crash nobody sees is a crash nobody fixes. Capped per page load: a
// render loop that throws every frame must not become a POST loop. Every
// failure here is swallowed, because the reporter must never become the
// bug it reports.
let left = 10
let report = (message: string, stack?: string) => {
  if (left-- <= 0) return
  try {
    fetch('/error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message,
        stack: stack?.slice(0, 2000),
        url: location.href,
        client_eid: clientId(),
      }),
    }).catch(() => {})
  } catch { /* no localStorage, no fetch — nothing worth a second crash */ }
}
addEventListener('error', (e) => report(e.message, e.error?.stack))
addEventListener('unhandledrejection', (e) => {
  report(String(e.reason?.message ?? e.reason), e.reason?.stack)
})

// Name this tab to the socket before it opens, so its writes journal a
// resolved actor (T-6669). Fill the cache, open the socket, render.
config.client = clientId()
config.agreement = agreementProbe(location.search)
await boot()

// The grandfather door: tasks-v1 linked '?task=<slug>', and old guidance also
// used human ids there. Resolve once the cache is full and
// REPLACE the URL — a legacy address shouldn't linger in history. An
// unknown slug just renders the root: a dead old link is not a crash.
let legacy = new URLSearchParams(location.search).get('task')
if (legacy) {
  let hit = Object.entries(cache.value).find(([eid, c]) =>
    c.alias?.slug == legacy || idOf(ent(eid)) == legacy
  )
  if (hit) {
    history.replaceState(null, '', `/${idOf(ent(hit[0]))}`)
    route.value = location.pathname + location.search
  }
}

render(<App />, document.body)

// Hot swap. The watcher says {hmr: gen}; we re-import the whole component
// graph under ?v=<gen> (the server stamps every relative import — hot.ts)
// and re-render it over the LIVING state: cache, camera, and route all
// survive because they live in live.ts, above the swap boundary. This
// file and live.ts never re-import — a change to them sends 'reload'
// instead. A typo mid-edit must not eat the page: a failed import or
// first render keeps the last good code, and only a failed REVERT — both
// generations broken — falls back to a real reload.
let Good = App
config.swap = async (gen) => {
  let Next = Good
  try {
    Next = (await import(`./components/App.tsx?v=${gen}`)).App as typeof App
    render(<Next />, document.body)
    Good = Next
    console.info(`code v${gen} live`)
  } catch (e) {
    report(`hot swap failed: ${e}`, (e as Error)?.stack)
    if (Next == Good) return
    try {
      render(<Good />, document.body)
    } catch {
      config.reload()
    }
  }
}

// A css-only edit re-fetches the stylesheet in place: no re-render, no
// lost scroll, focus, or half-typed text.
config.css = (gen) => {
  let link = document.querySelector<HTMLLinkElement>('link[rel=stylesheet]')
  if (link) link.href = `/styles.css?v=${gen}`
}
