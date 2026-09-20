// Where the vectors are KEPT and READ: the `rules` facet
// (`@yaks/embedding/rules`) — the vector table raised through the host's own
// connection, and the `.near` compiler the read door consults.
//
// `.near=<entity>&.order=similar` is a query, so it has to be answerable
// wherever a query is asked — `/query`, a subscription, a tool, the command
// line — and not only where somebody remembered to hand the compiler an
// extension. That is what this facet is for: a host that composed this plugin
// can ask for a neighbourhood, and one that did not gets the compiler's own
// refusal. Nobody wires it up.
//
// This package declares no COMPONENT. A vector is not a word anybody writes:
// it is derived from text somebody else's vocabulary declares, it never rides
// the wire, and no patch mints one — which is why the table is raised in SQL
// here rather than by the store. The one word `./vocab` does declare is the
// index's CHECK (./tools.ts), which is a tool and not a component.

import type { Plugin } from '@yaks/graph'
import type { Extension } from '@yaks/sql'
import { semantic } from './compile.ts'
import type { Driver } from './driver.ts'
import { schema } from './ddl.ts'
import { embedderOf, type Options } from './options.ts'

/** The vector table and its mark, in the host's own database. It contributes
 * no rule to `apply()`: nothing a client writes is a vector, and what keeps
 * the vectors true is the sweep (`./effects`), off the write path. */
export let rules = (host: { sql: Driver }): Plugin[] => {
  for (let statement of schema()) host.sql.exec(statement)
  return []
}

/** The `.near` and `.order=similar` compiler, over the vectors this host
 * keeps. One extension serves every query: it is told when a new one begins
 * (@yaks/sql `Begin`), so a neighbourhood never outlives the question that
 * resolved it. */
export let extend = (
  host: { sql: Driver },
  options: Options = {},
): Extension[] => [
  semantic(host.sql, embedderOf(options), {
    limit: options.neighbours,
    floor: options.floor,
  }),
]
