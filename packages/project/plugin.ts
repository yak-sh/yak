// The package as a graph plugin: the portfolio's components, the check over a
// board's saved query, and the one that keeps projects a tree.
//
// It takes the loaded vocabulary as an argument because a board's query is
// checked against the schema, not against this package — a board filtering
// `.author=dana` is only valid if the graph has an author property, and only
// the loaded vocabulary knows whether it does. So a graph is built in two
// steps, the way @yaks/edge's is: load the documents, then pass the same
// vocabulary to the plugin.

import { type Plugin, then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import type { Mark } from '@yaks/task'
import { projectDoc } from './comp.ts'
import { guarding } from './guard.ts'
import { nesting } from './tree.ts'

/**
 * The portfolio plugin: the `project`, `filed`, `board` and `venture`
 * components, and a `precondition` hook that refuses a board whose query would
 * quietly match nothing, or a project filed under one already under it.
 *
 * Passing no `marks` checks a board's statuses against the set the loaded
 * vocabulary declares — every package's `statuses` enum — so a server that
 * loads leases gets `wip` without this package being told about them. Pass
 * `marks` to check against exactly that list instead.
 */
export let projects = (vocab: Vocab, marks?: Mark[]): Plugin => {
  let boards = guarding(vocab, marks)
  return {
    name: '@yaks/project',
    vocab: [projectDoc],
    hooks: {
      precondition: (b, tx) => then(boards(b, tx), (b) => nesting(b, tx)),
    },
  }
}
