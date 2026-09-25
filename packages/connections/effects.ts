// What a host does about @yaks/connections at start-up: the
// `@yaks/connections/effects` entry point. When this process's own `process`
// row is created (@yaks/process `started`), the integrations this package
// builds are installed into the graph, trusted, since `built` is server-owned
// (./integrations.ts `install`). A graph already holding them as shipped is
// read once and written nothing.

import type { Watch } from '@yaks/effects'
import type { Eid, Graph } from '@yaks/graph'
import { install } from './integrations.ts'

/** @yaks/process's component, named here rather than imported: a component
 * name is just a string in either direction. */
let PROCESS = 'process'

/** What the handler is given: the graph, and the eid of this process's own
 * `process` row (@yaks/cli `Host.me`). */
export type Host = { graph: Graph; me: Eid }

/** The built integrations installed, once per process start. */
export let effects = (host: Host): Watch[] => [{
  comp: PROCESS,
  doc: 'install the built integrations, once per process start',
  created: async (e) => {
    if (e.entity.eid != host.me) return
    let change = await install(host.graph.read)
    if (change.length) await host.graph.apply(change, { trusted: true })
  },
}]
