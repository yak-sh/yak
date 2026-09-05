// The fleet's @yaks/sql derived-column registrations: the computed columns the
// generic compiler cannot know because their formulas are ours, not the
// schema's. `@yaks/sql` marks such a column `persist: false` in the vocabulary
// and takes its read expression from here (see @yaks/sql/derived.ts), so
// `.status=open` — the most common board filter — compiles through the index
// instead of falling to a JS scan of every task.
//
// This is fleet glue on purpose: it lives in our src/, not in the package, and
// the package ships zero registrations.

import type { Derived } from '@yaks/sql'

// task.status, exactly as statusOf computes it: a `cancelled` mark outranks a
// `completed` mark, then an active `claim` is wip, else open. The leading null
// guard mirrors a stored column read through a LEFT join — a non-task owner
// reads NULL, not 'open', so `.status=open` cannot match a non-task entity.
let statusExpr = (owner: string): string =>
  `(case when ${owner} is null then null` +
  ` when exists(select 1 from "cancelled" __s where __s."entity" = ${owner}) then 'cancelled'` +
  ` when exists(select 1 from "completed" __s where __s."entity" = ${owner}) then 'done'` +
  ` when exists(select 1 from "claim" __s where __s."entity" = ${owner}) then 'wip'` +
  ` else 'open' end)`

// The registrations handed to `compile`.
export let derived: Derived = {
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
