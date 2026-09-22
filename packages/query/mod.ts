// @yaks/query — a parser and a set of builders for the yaks query format, with
// no knowledge of any schema.
//
// It turns a query string into a plain, serializable AST, and exports a small
// set of composable builders that construct the same AST from code, so that
// `parse('.a=1 .b=2')` deep-equals `and(eq('a', '1'), eq('b', '2'))`.
//
// It knows the format — the prefix characters on a component name (`.comp`
// present, `!comp` absent, `+comp` ensure, `+!comp` gate, `*comp` mutable,
// `-comp` gone, meaning this write removed it, `#Name` resource, `$name`
// variable), the operators, any-of lists, ranges, time literals, the reserved
// directives (order, near, refs, count, distinct, tally, fields, `*`, limit,
// after, edges), the walk, the shape of a dotted path, and how tokens separate
// — and nothing about any schema. Whether `status` is a column, a reference or
// an enum, and how a field maps to storage, is left to a compiler that has a
// schema (`@yaks/sql` takes this AST plus a schema and compiles SQL). See
// README.

export * from './ast.ts'
export * from './parse.ts'
export * from './rule.ts'
export * from './time.ts'
export * from './teach.ts'
