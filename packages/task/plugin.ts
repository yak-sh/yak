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
 * The status ladder is not this plugin's to extend: a graph that leases its
 * tasks reads a held lease as `wip` by passing its own `marks` list to the
 * status readers, and to whoever checks a board's query
 * (`projects(vocab, marks)`, @yaks/project).
 *
 * ```ts
 * import { MARKS } from '@yaks/task'
 *
 * // let marks = [...MARKS, { status: 'wip', comp: 'claim', settled: false }]
 * ```
 *
 * The status itself is not stored and not written. It is computed from the
 * marks — see {@link https://jsr.io/@yaks/task/doc/~/derived | derived} for the
 * database's reading of that rule and
 * {@link https://jsr.io/@yaks/task/doc/~/compute | compute} for the in-memory
 * one.
 */
export let tasks = (): Plugin => ({
  name: '@yaks/task',
  vocab: [taskDoc],
})
