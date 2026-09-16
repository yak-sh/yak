// The mark: whether a persisted approximate index still matches the vectors.
//
// `nearest` is an exact scan and needs none of this. An approximate index — the
// `Rank` an application supplies for a large corpus — is built from the vector
// table and goes stale the moment a row moves. The triggers in ddl.ts set the
// mark inside the same statement as the write, so a crash between a write and
// a rebuild leaves the mark set and the next owner rebuilds; the owner clears
// it only once its rebuild has landed. Reads never touch it: a query that
// arrives while the mark is set answers from the last build, staler
// neighbours, never a write.

import type { Driver } from './driver.ts'
import { MARK, TABLE } from './ddl.ts'

/** Whether the vectors have moved since the index was last rebuilt. */
export let dirty = (db: Driver): boolean =>
  !!db.query(`select dirty from "${MARK}" where id = 1`, [])[0]?.dirty

/** Set the mark by hand — after rebuilding the vector table from elsewhere. */
export let mark = (db: Driver): void =>
  db.exec(`update "${MARK}" set dirty = 1 where id = 1`)

/** Clear the mark: the index now matches the vectors. Only a rebuild says so. */
export let clean = (db: Driver): void =>
  db.exec(`update "${MARK}" set dirty = 0 where id = 1`)

/** What a health check reads: the mark, and how many vectors it covers. */
export type State = { dirty: boolean; rows: number; newest: string | null }

/**
 * The index's maintenance state from plain tables, so any connection can report
 * it. A mark that stays set past the sweep's interval means nobody is
 * rebuilding.
 */
export let state = (db: Driver): State => {
  let head = db.query(
    `select count(*) as n, max(at) as newest from "${TABLE}"`,
    [],
  )[0]
  return {
    dirty: dirty(db),
    rows: Number(head?.n ?? 0),
    newest: (head?.newest as string | null) ?? null,
  }
}
