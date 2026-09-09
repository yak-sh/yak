// The graph surface a supervisor needs, which is two verbs wide: write a
// batch, and ask which processes have not exited.
//
// It is named rather than taken as a whole `Graph` because the second verb is
// the only READ this package makes, and a host that keeps its processes in a
// database of its own (the fleet's src/processes.ts does) can answer it with
// one statement instead of standing up a query engine. Over a @yaks/graph,
// {@link store} is that adapter and the read is one ordinary query line.

import type { Bundle, Graph } from '@yaks/graph'
import { EXIT, PROCESS } from './comp.ts'

/** Where a supervisor's rows live. */
export type Store = {
  /** apply a batch atomically → the batch as applied */
  apply: (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
  /** every process that has not exited, as whole bundles */
  running: () => Bundle[] | Promise<Bundle[]>
}

/** The query {@link store} asks: every process with no `exit` yet. */
export let RUNNING = `.${PROCESS}&.${EXIT}=`

/**
 * A @yaks/graph as this package's store — `running` is one ordinary query, so
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
})
