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
// Coverage is stated plainly. The common query path is exact — reverse hops
// (`.reviews>=5`, `.reviews.stars=5`) included; the advanced directives it
// cannot yet reach throw `Unsupported` rather than answer almost-right — see
// ./bind.ts for the exact list (the `.near` KNN and the `.edges`/`.reaches`
// graph walks).

import type { And } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { bind, type BindOpts } from './bind.ts'
import { type Frag, render } from './ir.ts'

export * from './ir.ts'
export * from './sqlite.ts'
export * from './derived.ts'
export { bind, type BindOpts, Unsupported } from './bind.ts'

// The compiled statement: a SQL string and the params it binds, in order.
export type Compiled = { sql: string; params: Frag['params'] }

// Compile an AST against a vocabulary to SQL + params. `opts.dialect` chooses
// the backend (SQLite by default), `opts.derived` supplies computed-column
// expressions, `opts.now` fixes the moment a time phrase resolves against.
// Throws `Unsupported` for a clause outside the common path.
export let compile = (
  ast: And,
  vocab: Vocab,
  opts: BindOpts = {},
): Compiled => render(bind(ast, vocab, opts))
