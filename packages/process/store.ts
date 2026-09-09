// The graph surface a supervisor needs, which is three verbs wide: write a
// batch, ask which processes have not exited, and ask which programs are
// wanted.
//
// It is named rather than taken as a whole `Graph` because those two READS are
// the only ones this package makes, and a host that keeps its processes in a
// database of its own (the fleet's src/processes.ts does) can answer them with
// one statement each instead of standing up a query engine. Over a @yaks/graph,
// {@link store} is that adapter and each read is one ordinary query line.

import type { Bundle, Graph } from '@yaks/graph'
import { EXIT, PROCESS, SERVICE } from './comp.ts'

/** Where a supervisor's rows live. */
export type Store = {
  /** apply a batch atomically → the batch as applied */
  apply: (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
  /** every process that has not exited, as whole bundles */
  running: () => Bundle[] | Promise<Bundle[]>
  /** every service row, whole — its `process`, `exit` and `stop` ride the same
   * bundle, because they ride the same entity */
  services: () => Bundle[] | Promise<Bundle[]>
}

/** The query {@link store} asks: every process with no `exit` yet. */
export let RUNNING = `.${PROCESS}&.${EXIT}=`

/** The query {@link store} asks for desired state: every service row. */
export let SERVICES = `.${SERVICE}`

/**
 * A @yaks/graph as this package's store — both reads are ordinary queries, so
 * nothing here is privileged.
 *
 * ```ts
 * import { store } from '@yaks/process'
 *
 * // let processes = store(graph)
 * ```
 */
export let store = (graph: Pick<Graph, 'read' | 'apply'>): Store => ({
  apply: (bundles) => graph.apply(bundles),
  running: () => graph.read(RUNNING),
  services: () => graph.read(SERVICES),
})
