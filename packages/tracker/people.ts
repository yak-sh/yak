// Whom a bug reached, read from its retained occurrences rather than copied.
// A reporter names the person a failure reached in its `user_id` tag and their
// kind in `account` (`person` or `test`): the caller of a connector tool, the
// signed-in viewer of an app, and for an app failure the kind of account that
// owns its space. Who wrote the occurrence (`created.by`) is the reporting
// process, never the person it reached. Historical hits stay on the bug;
// retention does not turn its counter backwards.

import type { Bundle } from '@yaks/graph'
import type { Computed } from '@yaks/match'
import {
  col,
  type Derived,
  eq,
  type Expr,
  fn,
  lit,
  select,
  sub,
  table,
} from '@yaks/sql/core'

let tagged = (b: Bundle, key: string): string | undefined => {
  let tags = (b.error as { tags?: Record<string, unknown> } | undefined)?.tags
  let v = tags?.[key]
  return typeof v == 'string' && v ? v : undefined
}
let occurrences = (bug: Bundle, list: readonly Bundle[]) =>
  list.filter((b) =>
    b.error && typeof b.error == 'object' &&
    (b.error as { bug?: unknown }).bug == bug.entity.eid
  )
// `person` sorts before `test`, so the least account named is `person` when
// any occurrence reached one, and `test` only when every named account is.
let least = (values: (string | undefined)[]) =>
  values.filter((v) => v != null).sort()[0] ?? null

export let computed: Computed = {
  'bug.people': (bug, index) =>
    bug.bug
      ? new Set(
        occurrences(bug, index.list).map((b) => tagged(b, 'user_id'))
          .filter((v) => v != null),
      ).size
      : null,
  'bug.account': (bug, index) =>
    bug.bug
      ? least(occurrences(bug, index.list).map((b) => tagged(b, 'account')))
      : null,
}

// One aggregate over a tag of the bug's occurrences. An empty tag is no tag.
let over = (owner: Expr, key: string, aggregate: (tag: Expr) => Expr) =>
  sub(select({
    cols: [aggregate(
      fn(
        'nullif',
        fn('json_extract', col('tags', 'e'), lit(`$.${key}`)),
        lit(''),
      ),
    )],
    from: table('error', 'e'),
    where: eq(col('bug', 'e'), owner),
  }))

export let derived: Derived = {
  'bug.people': {
    tag: 'number',
    expr: (owner) =>
      over(owner, 'user_id', (tag) => ({
        t: 'fn',
        name: 'count',
        args: [tag],
        distinct: true,
      })),
  },
  'bug.account': {
    tag: 'enum',
    values: ['person', 'test'],
    expr: (owner) => over(owner, 'account', (tag) => fn('min', tag)),
  },
}
