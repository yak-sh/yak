// The search index, as a host takes it (`@yaks/fts/rules`): the FTS5 tables
// and their triggers raised through the host's own connection, and the clause
// compiler that lets a query say a bare word.
//
// Both halves ride the `rules` facet because both are SQL over that one
// connection. The index keeps ITSELF — a trigger per searchable component —
// so a bulk load needs no second pass, and a column the graph stores under a
// content address is indexed through the text the host says it reads as.

import type { Plugin } from '@yaks/graph'
import type { Derived, Extension } from '@yaks/sql'
import type { Driver } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'
import { fields, schema, search } from './mod.ts'

/** Every column this vocabulary marks searchable, indexed as it is written. */
export let rules = (
  host: { vocab: Vocab; sql: Driver; derived?: Derived },
): Plugin[] => {
  for (let statement of schema(fields(host.vocab), host.derived ?? {})) {
    host.sql.exec(statement)
  }
  return []
}

/** A bare word in a query is a full-text match — which is what makes a search
 * string a valid board query, and a board query a search. */
export let extend = (host: { vocab: Vocab }): Extension[] => [
  search(fields(host.vocab)),
]
