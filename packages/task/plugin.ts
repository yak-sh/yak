// The package as a graph plugin: the components it declares. Who finished a
// task is kept on @yaks/kernel's `completed` mark by the kernel's own plugin.
// What a task is filed under, and the board that is a saved filter over the
// filing, belong to @yaks/project — and so does the guard over a board's query.

import type { Plugin } from '@yaks/graph'
import { taskDoc } from './comp.ts'

/**
 * The task plugin: the `task`, `cancelled` and `blocked` components and the
 * `requires` and `contains` relations. A task is done when it wears
 * @yaks/kernel's `completed`, so a graph of tasks loads the kernel beside it.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
 * import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
 * import { taskDoc, tasks } from '@yaks/task'
 *
 * let vocab = loadVocab([kernelDoc, edgeDoc, taskDoc], [
 *   kernelKeywords,
 *   edgeKeywords,
 * ])
 * let plugins = [kernel(), edges(vocab), tasks()]
 * let g = graph({ storage: ram(vocab), vocab, plugins })
 * ```
 *
 * The status itself is not stored and not written. `task` declares it as a
 * ladder of marks in the vocabulary (@yaks/vocab's `status` keyword), and
 * every store reads it from there. A graph that leases its tasks adds a rung
 * where it declares the lease, as @yaks/session reads a held claim as `wip`.
 */
export let tasks = (): Plugin => ({
  name: '@yaks/task',
  vocab: [taskDoc],
})
