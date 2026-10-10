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
// JavaScript. A status the vocabulary declares as a ladder (@yaks/vocab's
// `status` keyword) needs no expression from the caller: it is read from the
// declaration (./derived.ts `ladders`).
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

export * from './query.ts'
export * from './cascade.ts'
export { type At, type Gone, type On, type Plan, rule } from './match.ts'
export { type Statements, statements } from './statements.ts'
