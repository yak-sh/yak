// The extension point: how another package teaches this compiler to compile a
// clause it declines on its own.
//
// The binder covers the common query path exactly and refuses the rest by
// throwing `Unsupported`. Part of that rest is not missing work but work that
// belongs elsewhere: a full-text term needs a search index, a nearest-neighbour
// directive needs vectors, a graph walk needs a link table. Each of those is
// its own package, with exactly one thing to contribute here — how its clause
// becomes a condition over the same relational representation.
//
// An `Extension` is that contribution, registered the way a plugin contributes
// a vocabulary: a named object passed to
// `compile(ast, vocab, { extend: [...] })`. It claims clause kinds by name and,
// for each, is called with the clause and a `Site` — the vocabulary being
// compiled against, the dialect, the moment relative time phrases resolve
// against, the SQL naming the row's owner, and a `join` that pulls a component
// table into the statement. It returns a `Cond` (built with `and`/`or`/`raw`
// from ./ir.ts), or `null` to decline, which lets the binder fall back to its
// own compilation or to `Unsupported`.
//
// Extensions are consulted before the built-in compilation, so one may also
// replace a built-in predicate. A text clause has no built-in lowering at all:
// @yaks/fts contributes that clause along with the indexes it searches.
//
// Example — a text clause answered from a `shelf` table this compiler knows
// nothing about:
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
import type { Cond, Frag } from './ir.ts'
import type { Dialect } from './sqlite.ts'

// What a contributed compiler is given besides the clause: everything the
// binder itself works from, plus the one change it is allowed to make to the
// statement (asking for a table to be joined).
export type Site = {
  // the vocabulary being compiled against, for routing a path or reading a
  // column
  vocab: Vocab
  // the dialect, for its table names, value lowerings and join keys
  dialect: Dialect
  // the moment a relative time phrase resolves against
  now: number
  // the SQL naming this row's integer id in the entity table
  owner: string
  // pull a component's table into the statement as a LEFT JOIN; returns the
  // SQL naming that table's owner column
  join: (comp: string) => string
}

// One clause's compilation. Returning `null` declines — the binder then
// compiles the clause itself, or refuses it by throwing `Unsupported`.
export type Compile = (clause: Clause, site: Site) => Cond | null

// How an `.order=` value that names no column becomes an ORDER BY expression.
// `.order=` normally routes to a column, but an extension that ranks — a search
// by relevance, a vector search by similarity — sorts by something the
// vocabulary has no column for. It is given the order value with any leading
// `-` already stripped (the binder appends `desc` itself) and returns the order
// by expression, or `null` to decline so that the binder routes to a column as
// usual.
//
// The expression carries no bound parameters, because the ORDER BY in this
// representation holds none — an extension that ranks by data has to lower it
// to an expression over values it can write into the SQL safely (integer ids,
// a joined column).
export type OrderBy = (value: string, site: Site) => string | null

// A named contribution: which clause kinds it claims, how each of them
// compiles, and optionally how it writes an ORDER BY. A kind that is not in the
// map is left entirely to the binder.
export type Extension = {
  name: string
  compile: Partial<Record<Clause['kind'], Compile>>
  order?: OrderBy
  begin?: Begin
}

// One call to `bind` is one query, and this hook marks the boundary. An
// extension that compiles both a clause and an ORDER BY about the same thing
// has to remember what it resolved between the two calls — a set of
// neighbours, a parsed search term — and the process that opened the graph
// registers its extensions once and compiles every query through them. With no
// boundary between two queries, the second would rank using the first's
// leftover state. So the binder tells each extension that a new query has
// begun, before any of its clauses compile; an extension that remembers nothing
// between calls simply does not declare this hook.
//
// It is called with the query's {@link Screen}, because an extension that ranks
// needs one. A ranking cut to a limit before the rest of the query has filtered
// is a ranking of the wrong set: the eight nearest entities of any kind,
// intersected with "and is a memory", is usually nothing. The screen is what
// the rest of the query selects, so the extension ranks among those rows and
// cuts afterwards.
export type Begin = (screen: Screen) => void

// What the rest of the query selects: a statement over the same database
// returning the `eid`s that every other clause admits — this extension's own
// clauses left out, since they are what is being resolved, and the directives
// that shape an answer (order, limit, projection) left out, since they never
// narrow it. It is a function because compiling it costs something an extension
// that does not rank should not have to pay, and it returns null when there is
// nothing else in the query — there is nothing to narrow by, so every entity in
// the database is a candidate.
export type Screen = () => Frag | null
