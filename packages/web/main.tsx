import { entityPath } from './url.ts'
import { render } from 'preact'
import { agreementProbe, boot, cache, clientId, config, ent } from './live.ts'
import { idOf, slugsOf } from './types.ts'
import { restore, route } from './components/nav.tsx'
import { App } from './components/App.tsx'

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
    history.replaceState(null, '', entityPath(idOf(ent(hit[0]))))
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

render(<App />, document.body)
