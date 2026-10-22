// The extension point: how another package teaches this compiler to compile a
// clause it declines on its own.
//
// The binder covers the common query path exactly and refuses the rest by
// throwing `Unsupported`. Part of that rest is not missing work but work that
// belongs elsewhere: a full-text term needs a search index, a nearest-neighbour
// directive needs vectors, a graph walk needs a link table. Each of those is
// its own package, with exactly one thing to contribute here — how its clause
// becomes a condition over the same statement.
//
// An `Extension` is that contribution, registered the way a plugin contributes
// a vocabulary: a named object passed to
// `compile(ast, vocab, { extend: [...] })`. It claims clause kinds by name and,
// for each, is called with the clause and a `Site` — the vocabulary being
// compiled against, the moment relative time phrases resolve against, the
// expression naming the row's owner, and a `join` that pulls a component table
// into the statement. It returns a condition built from ./ast.ts, or `null` to
// decline, which lets the binder fall back to its own compilation or to
// `Unsupported`.
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
//           ? among(site.owner, select({
//             cols: [col('entity')],
//             from: table('shelf'),
//             where: eq(col('label'), val(clause.value)),
//           }))
//           : null,
//     },
//   }
//   compile(ast, vocab, { extend: [shelves] })

import { type And, type Clause, map } from '@yaks/query/core'
import type { Vocab } from '@yaks/vocab'
import {
  as,
  col,
  eq,
  exists,
  type Expr,
  from,
  lit,
  type Query,
  type Raw,
  select,
  type Source,
} from './ast.ts'
import type { BindOpts } from './bind.ts'

/** An owner-ID relation with an equivalent keyed membership predicate. */
export type Selection = Raw & { probe?: (owner: Expr) => Expr }

/** Test one owner without enumerating an iterable selection when the compiler
 * supplied its keyed form. Ordinary rendered relations keep SQL semantics. */
export let member = (selection: Selection, owner: Expr): Expr =>
  selection.probe?.(owner) ?? exists(select({
    cols: [lit(1)],
    from: from(select({ cols: [as(owner, 'id')] }), '__probe_key'),
    joins: [{ how: 'cross', src: from(selection, '__member') }],
    where: eq(col('id', '__member'), col('id', '__probe_key')),
  }))

// What a contributed compiler is given besides the clause: everything the
// binder itself works from, plus the one change it is allowed to make to the
// statement (asking for a table to be joined).
export type Site = {
  // the vocabulary being compiled against, for routing a path or reading a
  // property
  vocab: Vocab
  // the caller's relation restrictions, retained for standalone rankers
  visibility?: BindOpts['visibility']
  // the moment a relative time phrase resolves against
  now: number
  // this row's integer id in the entity table
  owner: Expr
  // Candidates for this owner scope, excluding this extension. Absent inside
  // child filters and another extension's screen, whose owner scope differs.
  screen?: Screen
  // Share an uncorrelated relation and its bindings across this statement.
  share: (query: Query) => Source
  // pull a component's table into the statement as a LEFT JOIN; returns that
  // table's owner column
  join: (comp: string) => Expr
  // where a component is read from, as a source of its own under `as` — its
  // table, or whatever the statement reads it from instead (the batch a rule
  // is evaluated against); `entity` names the spine
  from: (comp: string, as: string) => Source
}

// One clause's compilation. Returning `null` declines — the binder then
// compiles the clause itself, or refuses it by throwing `Unsupported`.
export type Compile = (clause: Clause, site: Site) => Expr | null

// How an `.order=` value that names no property becomes an ORDER BY expression.
// `.order=` normally routes to a property, but an extension that ranks — a
// search by relevance, a vector search by similarity — sorts by something the
// vocabulary has no property for. It is given the order value with any leading
// `-` already stripped (the binder appends `desc` itself) and returns the order
// by expression, or `null` to decline so that the binder routes to a property
// as usual.
//
// The expression is written into the statement with its values as literals,
// since the anchor a `.after` cursor pages from compares against it inside the
// condition as well as the ordering.
export type OrderBy = (value: string, site: Site) => Expr | null

// The order a window of a query that states none is answered in, as an
// `.order=` value this extension ranks by, or null to leave it newest first. A
// window of a search is its best rows, not its newest: @yaks/fts ranks a query
// with words in it by how well each row matches. Only a read's own query is
// asked (./kept.ts `compile`, through `ranking`), never a rule's patterns or a
// screen, and only by the extension that compiles the clauses it ranks.
export type Ranks = (q: And) => string | null

// A named contribution: which clause kinds it claims, how each of them
// compiles, and optionally how it writes an ORDER BY and which order a window
// that states none takes. A kind that is not in the map is left entirely to
// the binder.
export type Extension = {
  name: string
  compile: Partial<Record<Clause['kind'], Compile>>
  order?: OrderBy
  ranks?: Ranks
  begin?: Begin
}

// Directives after which a query's rows take no order of an extension's: an
// order already stated, and the aggregates, which answer values, not rows.
let SETTLED = new Set(['order', 'count', 'tally', 'distinct'])

/** `q` with the order an extension ranks it by (`Ranks`), when `q` is a window
 * (`.limit`, `.after`) that states no order: a window says how much of a
 * sequence to answer, and the sequence of a search is best match first. `q`
 * itself when it states an order, aggregates, answers whole (a complete answer
 * keeps its order, and its reader pays no ranking), or no extension ranks it.
 * An extension ranks only clauses no extension before it compiles.
 *
 * ```ts
 * import { parse, stringify } from '@yaks/query'
 * import { ranking } from '@yaks/sql'
 * import { equal } from '@yaks/testing'
 *
 * let fts = { name: 'fts', compile: { text: () => null }, ranks: () => 'search' }
 * let ranked = (q: string) => stringify(ranking([fts], parse(q)))
 * equal(ranked('hobbit .limit=5'), 'hobbit&.limit=5&.order=search')
 * equal(ranked('hobbit'), 'hobbit')
 * equal(ranked('hobbit&.count'), 'hobbit&.count')
 * equal(ranked('hobbit .limit=5 .order=book.price'), 'hobbit&.limit=5&.order=book.price')
 * let first = { name: 'shelf', compile: { text: () => null } }
 * equal(stringify(ranking([first, fts], parse('hobbit .limit=5'))), 'hobbit&.limit=5')
 * ```
 */
export let ranking = (exts: readonly Extension[], q: And): And => {
  if (!q.clauses.some((c) => c.kind == 'limit' || c.kind == 'after')) return q
  let settled = false
  map(q, (c) => {
    settled ||= SETTLED.has(c.kind)
    return c
  })
  if (settled) return q
  let taken = new Set<string>()
  for (let e of exts) {
    let kinds = Object.keys(e.compile)
    let value = !kinds.some((k) => taken.has(k)) && e.ranks?.(q)
    if (value) {
      return { ...q, clauses: [...q.clauses, { kind: 'order', value }] }
    }
    for (let k of kinds) taken.add(k)
  }
  return q
}

/** Whether any of `exts` compiles a clause of `q`, its order among them: the
 * query the binder lowers alone, wherever an extension is registered.
 *
 * ```ts
 * import { parse } from '@yaks/query'
 * import { claimed } from '@yaks/sql'
 *
 * let fts = { name: 'fts', compile: { text: () => null } }
 * claimed([fts], parse('.doc.title=a')) // false
 * claimed([fts], parse('.doc (a | .task)')) // true
 * ```
 */
export let claimed = (exts: readonly Extension[], q: Clause): boolean => {
  let found = false
  if (exts.length) {
    map(q, (c) => {
      found ||= exts.some((e) =>
        !!e.compile[c.kind] || c.kind == 'order' && !!e.order
      )
      return c
    })
  }
  return found
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
// returning, as `id`, the integer ids of the entities every other clause
// admits — the owner ids an extension's own rows are keyed by, in no order.
// This extension's own clauses are left out, since they are what is being
// resolved, and so are the directives that shape an answer (order, limit,
// projection), since they never narrow it. IDs key the ranker's own rows;
// member(screen, owner) uses the compiler's equivalent keyed predicate rather
// than hoping SQLite pushes a key through a union or distinct relation. It is
// a function because compiling it costs something an extension that does not
// rank should not have to pay, and it returns null when there is nothing else
// in the query — there is nothing to narrow by, so every entity in the database
// is a candidate.
export type Screen = (() => Selection | null) & {
  // A proven upper bound on owner count; a short list may drive key seeks.
  maximum?: number
}
