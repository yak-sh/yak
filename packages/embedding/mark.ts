// The dirty flag: whether a persisted approximate index still matches the
// vectors.
//
// `nearest` is an exact scan and needs none of this. An approximate index — the
// `Rank` an application supplies for a large corpus — is built from the vector
// table and goes out of date the moment a row changes. The triggers in ddl.ts
// set the flag inside the same statement as the write, so a crash between a
// write and a rebuild leaves the flag set and whoever owns the index next
// rebuilds it; the owner clears it only once its rebuild has finished. Reads
// never touch it: a query that arrives while the flag is set answers from the
// last build — staler neighbours, never a failed write.

import {
  as,
  col,
  count,
  type Driver,
  eq,
  fn,
  lit,
  select,
  table,
} from '@yaks/sql'
import { flag, MARK, TABLE } from './ddl.ts'

/** Whether the vectors have changed since the index was last rebuilt. */
export let dirty = (db: Driver): boolean =>
  !!db.query(select({
    cols: [col('dirty')],
    from: table(MARK),
    where: eq(col('id'), lit(1)),
  }))[0]?.dirty

/** Set the flag by hand — after rebuilding the vector table from somewhere
 * else. */
export let mark = (db: Driver): void => void db.query(flag(1))

/** Clear the flag: the index now matches the vectors. Only a finished rebuild
 * clears it. */
export let clean = (db: Driver): void => void db.query(flag(0))

/** What a health check reads: the flag, and how many vectors it covers. */
export type State = { dirty: boolean; rows: number; newest: string | null }

/**
 * The index's maintenance state, read from plain tables so any connection can
 * report it. A flag that stays set for longer than the sweep's interval means
 * nothing is rebuilding the index.
 */
export let state = (db: Driver): State => {
  let head = db.query(select({
    cols: [as(count(), 'n'), as(fn('max', col('at')), 'newest')],
    from: table(TABLE),
  }))[0]
  return {
    dirty: dirty(db),
    rows: Number(head?.n ?? 0),
    newest: (head?.newest as string | null) ?? null,
  }
}
