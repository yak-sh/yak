// What a host does about @yaks/connections when a process starts: the
// `@yaks/connections/effects` entry point, the code behind
// `integration_install` (./vocab.json). A `process` row is written by every
// process on its way in (@yaks/process `started`), and whichever process works
// the effects installs the integrations this package builds, trusted, since
// `built` is server-owned (./integrations.ts `install`). A graph already
// holding them as shipped is read once and written nothing, so a new build's
// integrations land with the first process it starts.

import type { Handlers } from '@yaks/effects'
import type { Graph } from '@yaks/graph'
import { install } from './integrations.ts'

/** What the handler is given: the graph. */
export type Host = { graph: Graph }

/** The built integrations installed, whenever a process starts. */
export let effects = (host: Host): Handlers => ({
  integration_install: async () => {
    let change = await install(host.graph.read)
    if (change.length) await host.graph.apply(change, { trusted: true })
  },
})
