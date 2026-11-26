// What a host does about @yaks/connections when it works the effects: the
// `@yaks/connections/effects` entry point.
//
// `integration_install` (./vocab.json) is a start-up effect (`start: true`).
// The process that starts working them installs the integrations this package
// builds, trusted, since `built` is server-owned (./integrations.ts
// `install`). A graph already holding them as shipped is read once and
// written nothing, so a new build's integrations land when its server starts.
//
// `connection_given` hands a key just given to the places its connection's
// `keep` names, checks it, and completes the tasks asking for it (./given.ts).

import type { Handlers } from '@yaks/effects'
import type { Graph } from '@yaks/graph'
import { install } from './integrations.ts'
import { given, type Host as Giving } from './given.ts'

/** What the handlers are given: the graph, its vault and the keepers the
 * host lends. */
export type Host = Giving & { graph: Graph }

/** The built integrations installed, whenever a process starts working the
 * effects, and a given key kept, checked and its asks completed. */
export let effects = (host: Host): Handlers => ({
  integration_install: async () => {
    let bundles = await install(host.graph.read)
    if (bundles.length) await host.graph.apply(bundles, { trusted: true })
  },
  connection_given: given(host),
})
