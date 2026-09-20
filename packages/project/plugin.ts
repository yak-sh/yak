// The package as a graph plugin: the portfolio's components, and the board
// guard over them.
//
// It takes the loaded vocabulary because a board's query is checked against the
// SCHEMA, not against this package — a board filtering `.author=dana` is only
// valid if the graph has an author column, and only the loaded vocabulary
// knows. So a graph is built in two steps, the way @yaks/edge's is: load the
// documents, then hand the same vocabulary to the plugin.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { type Mark, MARKS } from '@yaks/task'
import { projectDoc } from './comp.ts'
import { guarding } from './guard.ts'

/**
 * The portfolio plugin: the `project`, `filed`, `board` and `venture`
 * components, and a `precondition` hook that refuses a board whose query would
 * quietly match nothing.
 *
 * Pass `marks` when the graph's status ladder has a rung @yaks/task's default
 * does not — the guard checks the statuses a board's query names against the
 * same ladder the reader will use.
 */
export let projects = (vocab: Vocab, marks?: Mark[]): Plugin => ({
  name: '@yaks/project',
  vocab: [projectDoc],
  hooks: { precondition: guarding(vocab, marks) },
})
