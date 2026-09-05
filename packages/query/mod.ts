// @yaks/query — a generic, schema-agnostic parser and builder vocabulary for
// the yaks query format.
//
// It turns a query STRING into a plain, serializable AST, and gives a small
// composable set of builders that construct the SAME AST from code, so that
// `parse('.a=1&.b=2')` deep-equals `and(eq('a', '1'), eq('b', '2'))`.
//
// It knows the FORMAT — operators, any-of lists, ranges, time literals, the
// reserved directives (order, near, refs, count, distinct, tally, fields, `*`,
// limit, after, edges, reaches), dot-param routing shape, and how tokens
// separate — but nothing about any schema. Whether `status` is a real column, a
// reference, or an enum, and how a field maps to storage, is a downstream job
// (`@yaks/sql` takes this AST plus a schema and compiles SQL). See README.

export * from './ast.ts'
export * from './parse.ts'
export * from './time.ts'
