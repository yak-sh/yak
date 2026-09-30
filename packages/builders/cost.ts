// What a build cost, in dollars, read and never stored. A build asks its tool
// through a fresh call each time its key changes, so its spend is every call
// whose source it is: the `cost` a code tool's answer carried onto its call,
// and the entries of the session the model tool opened for it
// (`session.source`), which record what each request cost (@yaks/session).

import type { DerivedProp } from '@yaks/sql'
import {
  among,
  col,
  eq,
  fn,
  join,
  select,
  sub,
  table,
  unionAll,
} from '@yaks/sql'

/** `build.cost` as SQL, for @yaks/sqlite's derived-property registry. */
export let buildCost: DerivedProp = {
  tag: 'number',
  expr: (owner) => {
    let calls = {
      from: table('call', 'c'),
      where: eq(col('source', 'c'), owner),
    }
    return sub(select({
      cols: [fn('sum', col('dollars', 'k'))],
      from: table('cost', 'k'),
      where: among(
        col('entity', 'k'),
        unionAll(
          select({ cols: [col('entity', 'c')], ...calls }),
          select({
            cols: [col('entity', 'e')],
            ...calls,
            joins: [
              join(
                table('session', 's'),
                eq(col('source', 's'), col('entity', 'c')),
              ),
              join(
                table('entry', 'e'),
                eq(col('session', 'e'), col('entity', 's')),
              ),
            ],
          }),
        ),
      ),
    }))
  },
}
