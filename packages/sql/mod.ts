// @yaks/sql — the COMPILE half of the Arel seam. @yaks/query parses a query
// string to an AST; @yaks/vocab describes a component vocabulary; this package
// binds the two and lowers them to a SQL string plus bound params for a
// dialect (SQLite first).
//
// The pipeline is two passes over a dialect-agnostic relational IR:
//   bind(ast, vocab, opts) → Rel     route paths, coerce values, build joins
//   render(rel)            → {sql}   the dialect turns the IR into SQL text
// and `compile` is their composition. A value is ALWAYS a bound param, never a
// concatenated literal.
//
// The IR (./ir.ts) is Arel-shaped and carries the statement as data, so a new
// backend (D1, Postgres) is another renderer over the same value. The storage
// layout and value lowerings that ARE dialect-specific live behind a `Dialect`
// (./sqlite.ts); a SQLite layout is the one shipped.
//
// Computed columns — a vocab marks them `persist: false`, their value derived
// downstream — are supplied by the caller through a DERIVED hook (./derived.ts).
// A registered expression is what lets a computed column (a status rolled up
// from other rows, say) compile through the index instead of a JS scan.
//
// A clause this package declines may still be answered by ANOTHER package: an
// `Extension` (./extend.ts) claims a clause kind and lowers it to a condition
// over the same IR, and may spell an `.order=` value that names no column. That
// is the seam a full-text, vector, or graph-walk package registers through —
// `compile(ast, vocab, { extend: [...] })`.
//
// One thing here is not a query at all. The DEATH CASCADE (./cascade.ts) is a
// question about the vocabulary's reference death words rather than about a
// filter, and it compiles to a `with recursive` closure — the answer @yaks/graph's
// cascade phase asks a storage for, shared so @yaks/sqlite and @yaks/d1 do not
// each write it.
//
// Coverage is stated plainly. The common query path is exact — reverse hops
// (`.reviews>=5`, `.reviews.stars=5`) included; the advanced directives it
// cannot yet reach throw `Unsupported` rather than answer almost-right — see
// ./bind.ts for the exact list (the `.edges`/`.reaches` graph walks, and the
// `.near` KNN unless a vector package claims it).

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
export { bind, type BindOpts, Unsupported } from './bind.ts'

// The compiled statement: a SQL string and the params it binds, in order.
export type Compiled = { sql: string; params: Frag['params'] }

// Compile an AST against a vocabulary to SQL + params. `opts.dialect` chooses
// the backend (SQLite by default), `opts.derived` supplies computed-column
// expressions, `opts.extend` registers other packages' clause compilers, and
// `opts.now` fixes the moment a time phrase resolves against. Throws
// `Unsupported` for a clause outside the common path that nothing claims.
export let compile = (
  ast: And,
  vocab: Vocab,
  opts: BindOpts = {},
): Compiled => render(bind(ast, vocab, opts))
