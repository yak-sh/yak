// The package as a graph plugin: the portfolio's components, the check over a
// board's saved query, and the one that keeps projects a tree.
//
// It takes the loaded vocabulary as an argument because a board's query is
// checked against the schema, not against this package — a board filtering
// `.author=dana` is only valid if the graph has an author property, and only
// the loaded vocabulary knows whether it does. So a graph is built in two
// steps, the way @yaks/edge's is: load the documents, then pass the same
// vocabulary to the plugin.

import { after } from '@yaks/fp'
import { type Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { projectDoc } from './comp.ts'
import { guarding } from './guard.ts'
import { nesting } from './tree.ts'

/**
 * The portfolio plugin: the `project`, `filed`, `board` and `venture`
 * components, and a `precondition` hook that refuses a board whose query would
 * quietly match nothing, or a project filed under one already under it.
 *
 * A board's statuses are checked against the ladder the loaded vocabulary
 * declares, so a server that loads leases gets `wip` without this package
 * being told about them.
 */
export let projects = (vocab: Vocab): Plugin => {
  let boards = guarding(vocab)
  return {
    name: '@yaks/project',
    vocab: [projectDoc],
    hooks: {
      precondition: (b, tx) => after(boards(b, tx), (b) => nesting(b, tx)),
    },
  }
}
