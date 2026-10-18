// Where the vectors are kept and read: the `graph` export
// (`@yaks/embedding/graph`) — the vector table, which a writing host adds to its
// own database, the `.near` compiler the read path consults, and the
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

import type { Graph, Plugin } from '@yaks/graph'
import type { Reply } from '@yaks/tools'
import type { Derived, Extension, Raw } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { semantic } from './compile.ts'
import { type Statements, statements } from '@yaks/sql'
import { schema as tables } from './ddl.ts'
import { resolved } from './fields.ts'
import { chosen, type Options, ready, spaceOf } from './options.ts'
import { type Hit, meaning as search, type MeaningOpts } from './search.ts'
import { type Host, neighbours } from './neighbours.ts'

/** The vector tables, which a writing host adds with the
 * rest of its composed schema. It contributes no rule to `apply()`: nothing a
 * client writes is a vector, and what keeps the vectors in step with the text
 * is the sweep (`./service`), off the write path. */
export let schema = (host?: { storage: { statements?: Statements } }) =>
  tables(host ? statements(host.storage).ownership : undefined)

/** Binding the index does not create or migrate its tables. */
export let plugins = (): Plugin[] => []

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
  host: {
    storage: { statements?: Statements }
    vocab?: Vocab
    derived?: Derived
  },
  options: Options = {},
): Extension[] => {
  let db = statements(host.storage)
  let model = spaceOf(options.embedder)
  let text
  try {
    text = host.vocab
      ? resolved(chosen(host.vocab, options), host.derived)
      : undefined
  } catch {
    // An invalid text configuration waits, like the sweep's ready() result.
    return []
  }
  return model
    ? [semantic(db, { model }, {
      fields: text,
      limit: options.neighbours,
      floor: options.floor,
    })]
    : []
}

/** A phrase search over this graph's vectors, among what the `within` filter
 * line admits where one is given (the storage's `screen` compiles it). Resolve
 * options and the rows they name on every call: the service may have started
 * embedding after a key or a provider arrived, without a new host or a new
 * search function. */
export let meaning = (
  host: {
    storage: {
      statements?: Statements
      screen?: (query: string) => Raw | null
    }
    vocab: Vocab
    graph: Pick<Graph, 'get'>
    derived?: Derived
  },
  options: Options = {},
): (
  words: string,
  opts?: Pick<MeaningOpts, 'limit' | 'floor'> & { within?: string },
) => Promise<Hit[]> => {
  let db = statements(host.storage)
  let among = (within: string) => {
    let screen = host.storage.screen
    if (!screen) throw new Error('this storage cannot narrow a search')
    return () => screen(within)
  }
  return async (words, opts = {}) => {
    let { within, ...rest } = opts
    let now = await ready(host.vocab, options, host.graph)
    return now.embedder
      ? await search(
        db,
        resolved(now.text, host.derived),
        now.embedder,
        words,
        {
          ...rest,
          vocab: host.vocab,
          floor: rest.floor ?? options.floor,
          ...(within ? { screen: among(within) } : {}),
        },
      )
      : []
  }
}

/** What a direct tool call's answer carries beside the tool's own: for each
 * entity the call created, its nearest few of the same kind (./neighbours.ts),
 * so a twin is seen while it is being written. */
export let reply = (host: Host, options: Options = {}): Reply =>
  neighbours(host, options)
