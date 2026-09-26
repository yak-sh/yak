import { render } from 'preact'
import { agreementProbe, boot, clientId, config } from './live.ts'
import { restore } from './components/nav.tsx'
import { App } from './components/App.tsx'

// Name this tab to the socket before it opens, so its writes journal a
// resolved actor (T-6669). Fill the cache, open the socket, render.
config.client = clientId()
config.agreement = agreementProbe(location.search)
await boot()

// A cold launch at `/` — the manifest's start_url, so every app launch —
// resumes the card and view this device left off on, with the canvas
// seeded under it for the back gesture, and a legacy `?task=` link lands on
// its card once the id resolves. Here because nothing has painted yet, and
// nothing here waits on the wire.
restore()

// The cursor is update-only: nav.tsx publishes where this client
// looks, but nothing reads it back to move the tab. Rendering answers to the
// URL and to gestures, never to graph state, so there is no follow to arm here.

render(<App />, document.body)
