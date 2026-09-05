// The package as a graph plugin: the components, and the board guard over them.
//
// It takes the loaded vocabulary because a board's query is checked against the
// SCHEMA, not against this package — a board filtering `.author=dana` is only
// valid if the graph has an author column, and only the loaded vocabulary knows.
// So a graph is built in two steps, the way @yaks/edge's is: load the documents,
// then hand the same vocabulary to the plugin.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { taskDoc } from './comp.ts'
import { guarding } from './guard.ts'
import { type Mark, MARKS } from './words.ts'

/**
 * The task plugin: the `task`, `project`, `board`, `completed`, `cancelled` and
 * `blocked` components, the `requires` and `contains` relations, and a
 * `precondition` hook that refuses a board whose query would quietly match
 * nothing.
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
export let tasks = (vocab: Vocab, marks: Mark[] = MARKS): Plugin => ({
  name: '@yaks/task',
  vocab: [taskDoc],
  hooks: { precondition: guarding(vocab, marks) },
})
