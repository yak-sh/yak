// Whether an output is current, read and never stored. An output is current
// while its build still selects its binding and still wants the key the output
// was made under: a vanished binding marks the build stale, and a changed input
// gives the build a new key, and either way the output stays as history. A
// builder downstream selects `.built.current=true`, so what it gathers is what
// its upstream builds say now, never a point a rebuild dropped.

import type { DerivedProp } from '@yaks/sql'
import {
  and,
  col,
  eq,
  exists,
  isNull,
  join,
  lit,
  or,
  select,
  table,
} from '@yaks/sql'

/** `built.current` as SQL, for @yaks/sqlite's derived-property registry. */
export let builtCurrent: DerivedProp = {
  tag: 'bool',
  expr: (owner) =>
    exists(select({
      cols: [lit(1)],
      from: table('built', 'u'),
      joins: [
        join(table('build', 'b'), eq(col('entity', 'b'), col('build', 'u'))),
      ],
      where: and(
        eq(col('entity', 'u'), owner),
        eq(col('key', 'b'), col('key', 'u')),
        or(isNull(col('stale', 'b')), eq(col('stale', 'b'), lit(false))),
      ),
    })),
}
