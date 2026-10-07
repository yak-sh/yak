import './domain-host.tsx'
import './browser-links.ts'
// Mount the browsing app with the configured plugins’ shared views and home
// query. The door chooses the facets; domains own their queries and readings.
import { render } from 'preact'
import { agreementProbe, boot, clientId, config } from './live.ts'
import { restore } from './components/nav.tsx'
import { App } from './components/App.tsx'
import { extend, ux } from './components/registry.ts'
import { contributedViews, type Facet } from './components/inspect.tsx'
import { offer } from './components/Navigation.tsx'
import type { Hosting } from './hosting.ts'
import { lone } from '@yaks/draft/input'
import { Ux } from '@yaks/ux'

export let mount = async (
  facets: Facet[] = [],
  home?: Hosting['home'],
) => {
  if (home) {
    let g = globalThis as { YAK_WEB?: Hosting }
    g.YAK_WEB = {
      page: '',
      api: '',
      apply: '/web/apply',
      owner: '/web/owner',
      ...g.YAK_WEB,
      home,
    }
  }
  extend(contributedViews(facets))
  offer(facets.flatMap((f) => f.destinations ?? []))

  // Name this tab to the socket before it opens, so its writes journal a
  // resolved actor (T-6669). Fill the cache, open the socket, render.
  config.client = clientId()
  config.agreement = agreementProbe(location.search)
  await boot()
  // Until this browser is bound to someone, it types as the graph's lone
  // person (components/drafts.ts).
  void lone()

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
