import { render } from 'preact'
import { agreementProbe, boot, cache, clientId, config, ent } from './live.ts'
import { idOf, slugsOf } from './types.ts'
import { restore, route } from './components/nav.tsx'
import { App } from './components/App.tsx'
import { loadPlugins } from './plugins.ts'

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
        client: clientId(),
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
    slugsOf(c.alias).includes(legacy) || idOf(ent(eid)) == legacy
  )
  if (hit) {
    history.replaceState(null, '', `/${idOf(ent(hit[0]))}`)
    route.value = location.pathname + location.search
  }
}

// A cold launch at `/` — the manifest's start_url, so every app launch —
// resumes the card and view this device left off on, with the canvas
// seeded under it for the back gesture. Here because the cache is full
// (a remembered entity that died falls back) and nothing has painted yet.
restore()

// The cursor is update-only: nav.tsx publishes where this client
// looks, but nothing reads it back to move the tab. Rendering answers to the
// URL and to gestures, never to graph state, so there is no follow to arm here.

// Load configured plugins before the first render, so their renderers, actions
// and editors are registered when App mounts (D-18663 seam 1). The server hands
// the browser the list (it read TASKS_PLUGINS) as a JSON script; absent by
// default, so this imports nothing and the boot is unchanged.
let pluginTag = document.getElementById('tasks-plugins')?.textContent
await loadPlugins(pluginTag ? JSON.parse(pluginTag) : [])

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
