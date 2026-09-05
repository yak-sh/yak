// The extension seam: how ANOTHER package teaches this compiler to answer a
// clause it declines on its own.
//
// The binder covers the common query path exactly and declines the rest
// (an `Unsupported` throw). Part of that rest is not missing work but work that
// belongs elsewhere: a full-text term needs a search index, a nearest-neighbour
// directive needs vectors, a graph walk needs a link table. Each of those is
// its own package with exactly one thing to say to this one — how ITS clause
// becomes a condition over the same relational IR.
//
// An `Extension` is that sentence, registered the way a plugin contributes a
// vocabulary: a named object handed to `compile(ast, vocab, { extend: [...] })`.
// It claims clause KINDS by name and, for each, receives the clause and a
// `Site` — the bound vocabulary, the dialect, the reference moment, the SQL
// naming the row's owner, and a `join` that pulls a component table into the
// statement. It answers a `Cond` (composed with `and`/`or`/`raw` from ./ir.ts),
// or `null` to decline, which lets the binder fall back to its own compilation
// or to `Unsupported`.
//
// Extensions are consulted BEFORE the built-in compilation, so one may also
// replace a built-in — a search package that indexes many components takes over
// the dialect's single-index `text` lowering.
//
// Example — a `library` component whose `shelf` column is a filter this
// compiler has no grammar for:
//
//   let shelves: Extension = {
//     name: 'shelves',
//     compile: {
//       text: (clause, site) =>
//         clause.kind == 'text'
//           ? raw({
//             sql: `${site.owner} in (select entity from "shelf" where label = ?)`,
//             params: [clause.value],
//           })
//           : null,
//     },
//   }
//   compile(ast, vocab, { extend: [shelves] })

import type { Clause } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Cond } from './ir.ts'
import type { Dialect } from './sqlite.ts'

// What a contributed compiler is handed besides the clause: everything the
// binder itself works from, plus the one mutation it is allowed to make
// (asking for a table).
export type Site = {
  // the bound vocabulary, for routing a path or reading a column
  vocab: Vocab
  // the dialect, for its table names, value lowerings and join keys
  dialect: Dialect
  // the moment a relative time phrase resolves against
  now: number
  // the SQL naming this row's integer owner id (the spine id)
  owner: string
  // pull a component's table into the statement as a LEFT join; answers the
  // SQL naming that table's owner column
  join: (comp: string) => string
}

// One clause's compilation. Returning `null` DECLINES — the binder then
// compiles the clause itself, or refuses it as `Unsupported`.
export type Compile = (clause: Clause, site: Site) => Cond | null

// How an ORDER value that names no column is spelled. `.order=` normally routes
// to a column, but an extension that ranks — a search by relevance, a vector
// search by similarity — sorts by something the vocabulary has no column for.
// It is handed the order value with any leading `-` already stripped (the
// binder appends `desc` itself) and answers the ORDER BY expression, or `null`
// to decline so the binder routes to a column as usual.
//
// The expression carries no bound params, because the IR's ORDER BY holds
// none — an extension that ranks by data must lower it to an expression over
// values it can spell safely (integer ids, a joined column).
export type OrderBy = (value: string, site: Site) => string | null

// A named contribution: which clause kinds it claims, how each compiles, and
// optionally how it spells an ordering. A kind absent from the map is left
// entirely to the binder.
export type Extension = {
  name: string
  compile: Partial<Record<Clause['kind'], Compile>>
  order?: OrderBy
}
