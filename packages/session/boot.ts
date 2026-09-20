// What start-up owes a transcript: the `boot` facet a host takes
// (`@yaks/session/boot`).
//
// Nothing expires on its own — a lease with a timeout would have to be
// renewed, and a worker that is merely thinking hard would lose its lock
// mid-edit — so the one correction happens at the one moment there is a
// fresh, honest answer: start-up frees every lock whose holder is not a
// session in this graph (./reap.ts).

import type { Graph } from '@yaks/graph'
import { reapLeases } from './reap.ts'

/** What the facet is handed: the graph, once it is open. */
export type Host = { graph: Graph }

/** The facet a host takes: free the locks whose holder is gone. It reads no
 * options — there is nothing to configure about a lock nobody holds. */
export let boot = async (host: Host): Promise<void> => {
  await reapLeases(host.graph.storage)
}
