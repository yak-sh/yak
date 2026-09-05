// The derived-column hook. Some columns are declared in a vocabulary but never
// STORED — a vocab marks them `persist: false` — because their value is
// computed downstream from other rows. `@yaks/sql` cannot know those formulas
// (they belong to the application, not the schema), so it takes them from the
// caller: a `Derived` map from `comp.prop` to the SQL expression that reads the
// value. This is what lets a computed column compile through the index instead
// of falling to a JS scan of every row.
//
// A `Derived` entry also serves as a plain READ OVERRIDE for a STORED column
// whose read differs from its storage — e.g. a column that falls back to
// another when it was never written. The binder consults this map before the
// ordinary column lowering, so an override wins whether or not the column is
// `persist: false`.
//
// Example — a computed `order.total`, summed from the order's line items:
//
//   let total: DerivedCol = {
//     tag: 'number',
//     deps: [], // extra component tables the expression reads
//     expr: (owner) =>
//       `(select coalesce(sum("line"."amount"), 0) from "line"` +
//       ` where "line"."order" = ${owner})`,
//   }
//   compile(ast, vocab, { derived: { 'order.total': total } })

import type { Tag } from './sqlite.ts'

// One derived column. `expr(owner)` builds the read expression given the SQL
// that names THIS entity's integer owner id (the top-level owner, or a path's
// target int); `tag` is how a value coerces against it; `values` optionally
// carries the enum members; `deps` names extra component tables the expression
// reads and the binder must therefore LEFT JOIN.
export type DerivedCol = {
  tag: Tag
  values?: string[]
  deps?: string[]
  expr: (owner: string) => string
}

// The registry a caller supplies to `compile`, keyed `comp.prop`. `compile`
// takes no derived columns by default; an application with computed columns
// passes its own registrations in.
export type Derived = Record<string, DerivedCol>
