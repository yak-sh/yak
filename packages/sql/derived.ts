// The derived-property hook. Some properties are declared in a vocabulary but
// never stored — a vocabulary marks them `computed: true` — because their value
// is computed from other rows by the application. @yaks/sql cannot know those
// formulas (they belong to the application, not to the schema), so the caller
// passes them in: a `Derived` map from `comp.prop` to the SQL expression that
// reads the value. This is what lets a computed property be filtered in SQL,
// through an index, instead of scanning every row in JavaScript.
//
// A `Derived` entry also works as a plain read override for a stored property
// that is read differently from how it is stored — for instance a property that
// falls back to another one when it was never written. The binder consults this
// map before the dialect's own lowering, so an override wins whether or not
// the property is `computed: true`.
//
// Example — a computed `order.total`, summed from the order's line items:
//
//   let total: DerivedProp = {
//     tag: 'number',
//     deps: [], // extra component tables the expression reads
//     expr: (owner) =>
//       `(select coalesce(sum("line"."amount"), 0) from "line"` +
//       ` where "line"."order" = ${owner})`,
//   }
//   compile(ast, vocab, { derived: { 'order.total': total } })

import type { Tag } from './sqlite.ts'

// One derived property. `expr(owner)` builds the read expression, given the SQL
// that names this entity's integer id (the row being selected, or the integer
// id a path dereferenced to); `tag` is the type a value is coerced to before it
// is compared; `values` optionally lists the enum members; `deps` names extra
// component tables the expression reads, which the binder must therefore left
// join.
export type DerivedProp = {
  tag: Tag
  values?: string[]
  deps?: string[]
  expr: (owner: string) => string
  // Reads a value that is being replaced, without looking up the owner row.
  // Full-text-search triggers have to read the old and new values, and by then
  // the owner row may already have changed or been deleted, so an expression
  // that starts from the owner cannot safely maintain their index.
  text?: (stored: string) => string
  // Whether the entity must have the component for this expression to return a
  // value. A qualified path names its component as much as its property, so by
  // default the binder reads this property as NULL for an entity without the
  // component — the same answer every stored property gives through its left
  // join. `false` means this expression returns a value for such an entity as
  // well: `updated.at` falling back to `created.at`, because being created is
  // the last time an untouched row changed. Defaults to true.
  worn?: boolean
}

// The registry a caller passes to `compile`, keyed by `comp.prop`. `compile`
// has no derived properties by default; an application with computed properties
// passes its own in.
export type Derived = Record<string, DerivedProp>
