// @yaks/sql — SQL, and the only place SQL is written. Every statement another
// package runs is a value it builds from this package's nodes (./ast.ts), and
// `render` (./render.ts) is what turns one into text and parameters. A caller
// cannot write text through it: the one node that carries text, `Raw`, is made
// only here.
//
// Its largest user is the query compiler. @yaks/query parses a query string
// into an AST; @yaks/vocab describes the component schema; this package binds
// the two together into a statement:
//   bind(ast, vocab, opts) → Select   route paths, coerce values, build joins
//   render(select)         → Raw      the text and the bound parameters
// and `compile` is the two composed. A value is always a bound parameter, never
// a literal concatenated into the SQL. The storage layout and the value
// lowerings live behind the SQLite dialect (./sqlite.ts).
//
// Computed properties — a vocabulary marks them `computed: true`, meaning the
// value is computed by the application rather than stored — are supplied by the
// caller through the derived hook (./derived.ts). A registered expression is
// what lets a computed property (a status rolled up from other rows, say) be
// filtered in SQL, through an index, instead of scanning every row in
// JavaScript.
//
// A clause this package declines may still be compiled by another package: an
// `Extension` (./extend.ts) claims a clause kind and lowers it to a condition,
// and may also supply an `.order=` expression for a value that names no
// property. That is the extension point a full-text, vector, or graph-walk
// package registers through — `compile(ast, vocab, { extend: [...] })`.
//
// A rule's match (./match.ts) is several queries bound side by side into one
// statement, each pattern under names of its own.
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
import type { Raw } from './ast.ts'
import { render } from './render.ts'

export {
  type Alter,
  among,
  and,
  as,
  at,
  by,
  call,
  cast,
  col,
  type Column,
  type Compound,
  type Conflict,
  count,
  type CreateIndex,
  type CreateTable,
  type CreateTrigger,
  type CreateView,
  type CreateVirtual,
  cross,
  type Cte,
  type Delete,
  desc,
  type Drop,
  each,
  eq,
  exists,
  type Explain,
  type Expr,
  FALSE,
  fn,
  from,
  ge,
  gt,
  iff,
  type Insert,
  insert,
  isNull,
  isRaw,
  type Join,
  join,
  type Key,
  le,
  left,
  lit,
  lt,
  ne,
  neg,
  not,
  notNull,
  NOW,
  type Op,
  op,
  or,
  over,
  type Param,
  type Pragma,
  type Query,
  raise,
  type Raw,
  type Ref,
  type Refusal,
  type Select,
  select,
  type Source,
  star,
  type Stmt,
  sub,
  table,
  TRUE,
  type Tx,
  union,
  unionAll,
  type Update,
  type Upsert,
  val,
  type Values,
  when,
  type Write,
} from './ast.ts'
export { render } from './render.ts'
export { type Driver, effect, type Row, scan, tally } from './driver.ts'
export { type Tag, tagOf } from './sqlite.ts'
export * from './cascade.ts'
export * from './compound.ts'
export * from './derived.ts'
export * from './extend.ts'
export * from './ident.ts'
export { walk } from './walk.ts'
export * from './archetype.ts'
export { type At, type Gone, type On, type Plan, rule } from './match.ts'
export { bind, type BindOpts, Unsupported, whole } from './bind.ts'

/** A compiled statement: its SQL and the parameters it binds, in order. */
export type Compiled = Raw

// Compile an AST against a vocabulary into SQL plus parameters.
// `opts.derived` supplies computed-property expressions, `opts.extend`
// registers other packages' clause compilers, and `opts.now` fixes the moment a
// relative time phrase resolves against. Throws `Unsupported` for a clause
// outside the common path that no extension claims.
export let compile = (
  ast: And,
  vocab: Vocab,
  opts: BindOpts = {},
): Compiled => render(bind(ast, vocab, opts))
