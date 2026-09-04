// The derived-column hook. Some columns are declared in the vocabulary but
// never STORED — a vocab marks them `persist: false` — because their value is
// computed downstream from other rows. `@yaks/sql` cannot know those formulas
// (they are the app's, not the schema's), so it takes them from the caller: a
// `Derived` map from `comp.prop` to the SQL expression that reads the value.
//
// This is what lets `.status=open` — the single most common board filter —
// compile through the index instead of falling to a JS scan of every task.
// task.status is derived (a `cancelled` mark outranks `completed`, then an
// active claim is wip, else open); the fleet registers exactly that expression
// below and hands it to `compile`.
//
// A `Derived` entry also serves as a plain READ OVERRIDE for a stored column
// whose read differs from its storage — the fleet's `updated.at`, which reads
// its `created.at` for a row never touched since it was made. The binder
// consults this map before the ordinary column lowering, so an override wins
// whether or not the column is `persist: false`.

import type { Tag } from './sqlite.ts'

// One derived column. `expr(owner)` builds the read expression given the SQL
// that names THIS entity's integer owner id (`"task"."entity"` at the top
// level, or a path's target int); `tag` is how a value coerces against it;
// `values` optionally carries the enum members; `deps` names extra component
// tables the expression reads and the binder must therefore LEFT JOIN.
export type DerivedCol = {
  tag: Tag
  values?: string[]
  deps?: string[]
  expr: (owner: string) => string
}

// The registry a caller supplies to `compile`. Keyed `comp.prop`.
export type Derived = Record<string, DerivedCol>

// task.status, exactly as the fleet's statusOf computes it: a `cancelled` mark
// outranks a `completed` mark, then an active `claim` is wip, else open. The
// leading null guard mirrors a stored column read through a LEFT join — a
// non-task owner reads NULL, not 'open', so `.status=open` cannot match a
// non-task entity.
let statusExpr = (owner: string): string =>
  `(case when ${owner} is null then null` +
  ` when exists(select 1 from "cancelled" __s where __s."entity" = ${owner}) then 'cancelled'` +
  ` when exists(select 1 from "completed" __s where __s."entity" = ${owner}) then 'done'` +
  ` when exists(select 1 from "claim" __s where __s."entity" = ${owner}) then 'wip'` +
  ` else 'open' end)`

// The fleet's registrations. `compile` takes no derived columns by default; the
// fleet (and any app with computed columns) passes this in.
export let fleetDerived: Derived = {
  'task.status': {
    tag: 'enum',
    values: ['open', 'wip', 'done', 'cancelled'],
    expr: statusExpr,
  },
  // A row never touched since it was made reads its created.at as its
  // updated.at — being made IS the last time it changed. Both tables are
  // joined; the expression is owner-free, reading the aliases directly.
  'updated.at': {
    tag: 'time',
    deps: ['created'],
    expr: () => `coalesce("updated"."at", "created"."at")`,
  },
}
