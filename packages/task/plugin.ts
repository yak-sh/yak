// The package as a graph plugin: the components it declares, plus the hook that
// keeps the author of a completion on the mark. What a task is filed under, and
// the board that is a saved filter over the filing, belong to @yaks/project —
// and so does the guard over a board's query.

import type { Plugin } from '@yaks/graph'
import { completing } from './completion.ts'
import { taskDoc } from './comp.ts'

/**
 * The task plugin: the `task`, `completed`, `cancelled` and `blocked`
 * components, the `requires` and `contains` relations, and a `precondition`
 * hook that records who completed a task.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
 * import { taskDoc, tasks } from '@yaks/task'
 *
 * let vocab = loadVocab([edgeDoc, taskDoc], [edgeKeywords])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [edges(vocab), tasks()] })
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
  hooks: { precondition: (bundles, tx) => completing(bundles, tx) },
})
