// Where the vectors are KEPT and READ: the `rules` export
// (`@yaks/embedding/rules`) — the vector table created through the server's own
// database connection, and the `.near` compiler the read path consults. "The
// server" here means whichever process opened the graph and loaded this
// package.
//
// `.near=<entity>&.order=similar` is a query, so it has to be answerable
// wherever a query is asked — `GET /query`, a subscription, an MCP tool, the
// CLI — and not only where somebody remembered to pass the compiler an
// extension. That is what this export is for: a server that composed this
// plugin can ask for a neighbourhood, and one that did not gets the compiler's
// own refusal. Nobody wires it up by hand.
//
// This package declares no COMPONENT. No client ever writes a vector: it is
// derived from text another package's vocabulary declares, it is never sent to
// a client, and no patch creates one — which is why the table is created in SQL
// here rather than by the store. The one thing `./vocab` does declare is the
// index's CHECK (./tools.ts), which is a tool and not a component.

import type { Plugin } from '@yaks/graph'
import type { Extension } from '@yaks/sql'
import { semantic } from './compile.ts'
import type { Driver } from './driver.ts'
import { schema } from './ddl.ts'
import { embedderOf, type Options } from './options.ts'

/** The vector table and its dirty flag, in the server's own database. It
 * contributes no rule to `apply()`: nothing a client writes is a vector, and
 * what keeps the vectors in step with the text is the sweep (`./effects`), off
 * the write path. */
export let rules = (host: { sql: Driver }): Plugin[] => {
  for (let statement of schema()) host.sql.exec(statement)
  return []
}

/** The `.near` and `.order=similar` compiler, over the vectors this server
 * stores. One extension serves every query: it is told when a new one begins
 * (@yaks/sql `Begin`), so a neighbourhood never outlives the query that
 * resolved it.
 *
 * What it needs is the vector SPACE, not the embedding function — compiling a
 * query reads the vector an entity already has and never embeds anything — so
 * a server still waiting for a key can still answer `.near` over whatever is
 * stored. Only a config that names no embedder at all has no space to rank in;
 * that one contributes no extension, and `.near` gets the compiler's own
 * refusal. */
export let extend = (
  host: { sql: Driver },
  options: Options = {},
): Extension[] => {
  let { model } = embedderOf(options)
  return model
    ? [semantic(host.sql, { model }, {
      limit: options.neighbours,
      floor: options.floor,
    })]
    : []
}
