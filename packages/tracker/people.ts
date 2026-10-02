// Distinct actors among a bug's retained occurrences, read rather than copied.
// Historical hits stay on the bug; retention does not turn its counter backwards.

import type { Computed } from '@yaks/match'
import {
  and,
  col,
  type Derived,
  eq,
  join,
  notNull,
  select,
  sub,
  table,
} from '@yaks/sql'

export let computed: Computed = {
  'bug.people': (bug, index) =>
    bug.bug
      ? new Set(
        index.list
          .filter((b) =>
            b.error && typeof b.error == 'object' &&
            b.error.bug == bug.entity.eid
          )
          .map((b) =>
            b.created && typeof b.created == 'object' ? b.created.by : null
          ).filter((v) => v != null),
      ).size
      : null,
}
export let derived: Derived = {
  'bug.people': {
    tag: 'number',
    expr: (owner) =>
      sub(select({
        cols: [{
          t: 'fn',
          name: 'count',
          args: [col('by', 'c')],
          distinct: true,
        }],
        from: table('error', 'e'),
        joins: [
          join(
            table('created', 'c'),
            eq(col('entity', 'e'), col('entity', 'c')),
          ),
        ],
        where: and(eq(col('bug', 'e'), owner), notNull(col('by', 'c'))),
      })),
  },
}
