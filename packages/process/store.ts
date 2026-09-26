// The graph interface a supervisor needs, which is four methods wide: write a
// list of bundles in one transaction, read given rows whole, ask which
// processes have not exited, and ask which programs are wanted.
//
// It is a named interface rather than a whole `Graph` because those reads are
// the only ones this package makes, and a caller that keeps its processes in a
// database of its own (the fleet's src/processes.ts does) can implement them
// with one statement each instead of standing up a query engine. Over a
// @yaks/graph, {@link store} is that adapter and each read is one ordinary
// read.

import type { Bundle, Graph } from '@yaks/graph'
import { EXIT, PROCESS, SERVICE } from './comp.ts'

/** Where a supervisor's rows live. */
export type Store = {
  /** write these bundles in one transaction → the bundles as written */
  apply: (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
  /** the rows these eids name, whole; an eid nothing stands for is left out */
  get: (eids: string[]) => Bundle[] | Promise<Bundle[]>
  /** every process that has not exited, as whole bundles */
  running: () => Bundle[] | Promise<Bundle[]>
  /** every service row, whole — its `process`, `exit` and `stop` components
   * come back in the same bundle, because they are on the same entity */
  services: () => Bundle[] | Promise<Bundle[]>
}

/** The query {@link store} runs: every process with no `exit` yet, whole. */
export let RUNNING = `.${PROCESS}&!${EXIT}&*`

/** The query {@link store} runs for what is wanted: every service row. */
export let SERVICES = `.${SERVICE}&*`

/**
 * A @yaks/graph as this package's store — every read is an ordinary one, so
 * nothing here needs privileged access.
 *
 * ```ts
 * import { store } from '@yaks/process'
 *
 * // let processes = store(graph)
 * ```
 */
export let store = (graph: Pick<Graph, 'read' | 'apply' | 'get'>): Store => ({
  apply: (bundles) => graph.apply(bundles),
  get: (eids) => graph.get(eids),
  running: () => graph.read(RUNNING),
  services: () => graph.read(SERVICES),
})
