// Current outputs belong to still-selected bindings. A pending replacement
// keeps playing the existing output until its answer lands.
// T-66411 expansion: retain this reader while the rehearsal-only /19 mover
// adopts frozen input provenance. Restore input equality once every store moved.

import type { DerivedProp } from '@yaks/sql'
import {
  and,
  col,
  eq,
  exists,
  isNull,
  join,
  lit,
  ne,
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
        exists(select({
          cols: [lit(1)],
          from: table('chosen', 'ch'),
          where: eq(col('entity', 'ch'), owner),
        })),
        or(isNull(col('stale', 'b')), eq(col('stale', 'b'), lit(false))),
      ),
    })),
}

/** A definition edit is discoverable without invalidating current outputs. */
export let buildOutdated: DerivedProp = {
  tag: 'bool',
  expr: (owner) =>
    exists(select({
      cols: [lit(1)],
      from: table('build', 'b'),
      joins: [
        join(
          table('builder', 'd'),
          eq(col('entity', 'd'), col('builder', 'b')),
        ),
      ],
      where: and(
        eq(col('entity', 'b'), owner),
        or(
          isNull(col('definition', 'b')),
          ne(col('definition', 'b'), col('definition', 'd')),
        ),
      ),
    })),
}
