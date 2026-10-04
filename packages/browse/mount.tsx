// Mount the browsing app with the configured plugins’ shared views and home
// query. The door chooses the facets; domains own their queries and readings.
import { render } from 'preact'
import { agreementProbe, boot, clientId, config } from './live.ts'
import { restore } from './components/nav.tsx'
import { App } from './components/App.tsx'
import { extend, ux } from './components/registry.ts'
import { adaptViews } from './components/inspect.tsx'
import type { Registry } from '@yaks/render'
import type { View } from '@yaks/inspect'
import type { Hosting } from './hosting.ts'
import { lone } from './components/drafts.ts'
import { Ux } from '@yaks/ux'

export let mount = async (
  facets: { views?: Registry; inspectViews?: View[] }[] = [],
  home?: Hosting['home'],
) => {
  if (home) {
    let g = globalThis as { YAK_WEB?: Hosting }
    g.YAK_WEB = {
      page: '',
      api: '',
      apply: '/web/apply',
      owner: '/web/owner',
      inspect: '/inspect',
      ...g.YAK_WEB,
      home,
    }
  }
  extend(
    facets.flatMap((
      f,
    ) => [...adaptViews(f.inspectViews ?? []), ...(f.views?.renderers ?? [])]),
  )

  // Name this tab to the socket before it opens, so its writes journal a
  // resolved actor (T-6669). Fill the cache, open the socket, render.
  config.client = clientId()
  config.agreement = agreementProbe(location.search)
  await boot()
  // Until this browser is bound to someone, it types as the graph's lone
  // person (components/drafts.ts).
  void lone()

  // A cold launch at `/` — the manifest's start_url, so every app launch —
  // resumes the card and view this device left off on, with the canvas
  // seeded under it for the back gesture, and a legacy `?task=` link lands on
  // its card once the id resolves. Here because nothing has painted yet, and
  // nothing here waits on the wire.
  restore()

  // The cursor is update-only: nav.tsx publishes where this client
  // looks, but nothing reads it back to move the tab. Rendering answers to the
  // URL and to gestures, never to graph state, so there is no follow to arm here.

  render(
    <Ux host={ux}>
      <App />
    </Ux>,
    document.body,
  )
}
