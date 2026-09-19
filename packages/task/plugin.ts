// The package as a graph plugin: the components, and the stamp a finished task
// gets. What a task is FILED under, and the board that is a saved filter over
// the filing, are @yaks/project's — and so is the guard over a board's query.

import type { Plugin } from '@yaks/graph'
import { completing } from './completion.ts'
import { taskDoc } from './comp.ts'

/**
 * The task plugin: the `task`, `completed`, `cancelled` and `blocked`
 * components, the `requires` and `contains` relations, and the `precondition`
 * hook that stamps a completion with its moment and its author.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
 * import { taskDoc, tasks } from '@yaks/task'
 *
 * let vocab = loadVocab([edgeDoc, taskDoc, mine], [edgeKeywords])
 * // let g = graph({ storage, vocab, plugins: [edges(vocab), tasks(vocab)] })
 * ```
 *
 * Pass `marks` to add a rung to the status ladder — a graph that leases its
 * tasks reads a held lease as `wip`:
 *
 * ```ts
 * import { MARKS, tasks } from '@yaks/task'
 *
 * // tasks(vocab, [...MARKS, { status: 'wip', comp: 'claim', settled: false }])
 * ```
 *
 * The status itself is not stored and not written. It is read off the marks —
 * see {@link https://jsr.io/@yaks/task/doc/~/derived | derived} for the
 * database's reading of that rule and
 * {@link https://jsr.io/@yaks/task/doc/~/compute | compute} for the in-memory
 * one.
 */
export let tasks = (): Plugin => ({
  name: '@yaks/task',
  vocab: [taskDoc],
  hooks: { precondition: (bundles, tx) => completing(bundles, tx) },
})
