// @yaks/sql — the compile half of the query stack. @yaks/query parses a query
// string into an AST; @yaks/vocab describes the component schema; this package
// binds the two together and lowers them to a SQL string plus the parameters to
// bind, for one backend (SQLite first).
//
// The pipeline is two passes over a backend-independent relational
// representation:
//   bind(ast, vocab, opts) → Rel     route paths, coerce values, build joins
//   render(rel)            → {sql}   the dialect turns that into SQL text
// and `compile` is the two composed. A value is always a bound parameter, never
// a literal concatenated into the SQL.
//
// The representation (./ir.ts) is shaped like Arel and holds the statement as
// data, so a new backend (D1, Postgres) is another renderer over the same
// value. The storage layout and the value lowerings that are backend-specific
// live behind a `Dialect` (./sqlite.ts); the SQLite layout is the one shipped.
//
// Computed properties — a vocabulary marks them `computed: true`, meaning the
// value is computed by the application rather than stored — are supplied by the
// caller through the derived hook (./derived.ts). A registered expression is
// what lets a computed property (a status rolled up from other rows, say) be
// filtered in SQL, through an index, instead of scanning every row in
// JavaScript.
//
// A clause this package declines may still be compiled by another package: an
// `Extension` (./extend.ts) claims a clause kind and lowers it to a condition
// over the same representation, and may also supply an `.order=` expression for
// a value that names no property. That is the extension point a full-text,
// vector, or graph-walk package registers through —
// `compile(ast, vocab, { extend: [...] })`.
//
// One thing here is not a query at all. The death cascade (./cascade.ts) is a
// question about what the vocabulary declares should happen to a reference
// property when the entity it points at is deleted, rather than about a filter,
// and it compiles to a `with recursive` closure — the answer @yaks/graph's
// cascade phase asks a storage backend for, kept here so @yaks/sqlite and
// @yaks/d1 do not each write it.
//
// Coverage is stated plainly. The common query path is here and exact, reverse
// hops (`.reviews>=5`, `.reviews.stars=5`) included; anything outside it throws
// `Unsupported` rather than return an almost-right answer — see ./bind.ts for
// the exact list (the `.edges` rider, an edge-typed walk, and the `.near`
// nearest-neighbour search unless a vector package claims it).

import type { And } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { bind, type BindOpts } from './bind.ts'
import { type Frag, render } from './ir.ts'

export * from './ir.ts'
export * from './sqlite.ts'
export * from './cascade.ts'
export * from './compound.ts'
export * from './derived.ts'
export * from './extend.ts'
export * from './ident.ts'
export * from './walk.ts'
export * from './archetype.ts'
export { bind, type BindOpts, Unsupported } from './bind.ts'

// The compiled statement: a SQL string and the parameters to bind to it, in
// order.
export type Compiled = { sql: string; params: Frag['params'] }

// Compile an AST against a vocabulary into SQL plus parameters. `opts.dialect`
// chooses the backend (SQLite by default), `opts.derived` supplies
// computed-property expressions, `opts.extend` registers other packages' clause
// compilers, and `opts.now` fixes the moment a relative time phrase resolves
// against. Throws `Unsupported` for a clause outside the common path that no
// extension claims.
export let compile = (
  ast: And,
  vocab: Vocab,
  opts: BindOpts = {},
): Compiled => render(bind(ast, vocab, opts))
