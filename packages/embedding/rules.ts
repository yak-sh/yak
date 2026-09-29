// Where the vectors are kept and read: the `rules` export
// (`@yaks/embedding/rules`) — the vector table created through the server's own
// database connection, the `.near` compiler the read path consults, and the
// reply a tool call that created something is answered with (./neighbours.ts).
// "The server" here means whichever process opened the graph and loaded this
// package.
//
// `.near=<entity>&.order=similar` is a query, so it has to be answerable
// wherever a query is asked — `GET /query`, a subscription, an MCP tool, the
// CLI — and not only where somebody remembered to pass the compiler an
// extension. That is what this export is for: a server that composed this
// plugin can ask for a neighbourhood, and one that did not gets the compiler's
// own refusal. Nobody wires it up by hand.
//
// This package declares no component. No client ever writes a vector: it is
// derived from text another package's vocabulary declares, it is never sent to
// a client, and no patch creates one — which is why the table is created in SQL
// here rather than by the store. The one thing `./vocab` does declare is the
// index's check (./tools.ts), which is a tool and not a component.

import type { Plugin } from '@yaks/graph'
import type { Reply } from '@yaks/tools'
import type { Derived, Extension } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { semantic } from './compile.ts'
import type { Driver } from '@yaks/sql'
import { schema } from './ddl.ts'
import { resolved } from './fields.ts'
import { embedderOf, type Options, ready } from './options.ts'
import { type Hit, meaning as search, type MeaningOpts } from './search.ts'
import { type Host, neighbours } from './neighbours.ts'

/** The vector table and its dirty flag, in the server's own database. It
 * contributes no rule to `apply()`: nothing a client writes is a vector, and
 * what keeps the vectors in step with the text is the sweep (`./service`), off
 * the write path. */
export let rules = (host: { sql: Driver }): Plugin[] => {
  for (let statement of schema()) host.sql.query(statement)
  return []
}

/** The `.near` and `.order=similar` compiler, over the vectors this server
 * stores. One extension serves every query: it is told when a new one begins
 * (@yaks/sql `Begin`), so a neighbourhood never outlives the query that
 * resolved it.
 *
 * What it needs is the vector space, not the embedding function — compiling a
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

/** A phrase search over this graph's vectors. Resolve options on every call:
 * the service may have started embedding after a key arrived, without a new
 * host or a new search function. */
export let meaning = (
  host: { sql: Driver; vocab: Vocab; derived?: Derived },
  options: Options = {},
): (words: string, opts?: MeaningOpts) => Promise<Hit[]> =>
async (words, opts) => {
  let now = ready(host.vocab, options)
  return now.embedder
    ? await search(
      host.sql,
      resolved(now.text, host.derived),
      now.embedder,
      words,
      { ...opts, floor: opts?.floor ?? options.floor },
    )
    : []
}

/** What a direct tool call's answer carries beside the tool's own: for each
 * entity the call created, its nearest few of the same kind (./neighbours.ts),
 * so a twin is seen while it is being written. */
export let reply = (host: Host, options: Options = {}): Reply =>
  neighbours(host, options)
