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
import type { Mark } from '@yaks/task'
import { projectDoc } from './comp.ts'
import { guarding } from './guard.ts'

/**
 * The portfolio plugin: the `project`, `filed`, `board` and `venture`
 * components, and a `precondition` hook that refuses a board whose query would
 * quietly match nothing.
 *
 * Naming no `marks` checks a board's statuses against the ladder the loaded
 * VOCABULARY declares — every package's `statuses` enum, so a host composing
 * leases knows `wip` without this package being told about them. Pass `marks`
 * to check against exactly that ladder instead.
 */
export let projects = (vocab: Vocab, marks?: Mark[]): Plugin => ({
  name: '@yaks/project',
  vocab: [projectDoc],
  hooks: { precondition: guarding(vocab, marks) },
})
