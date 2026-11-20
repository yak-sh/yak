// A store's file read out for the platform's admin a page at a time, so a
// migration is rehearsed on copies before it runs (`yak admin copy`): a
// space's Operator store, which its Builder's object holds (build.ts), or an
// app's store, which its Store object holds (graph.ts). A copy is what the
// file holds, every table under its own rowids (@yaks/durable-object's copy
// protocol), read while the store serves, so tables read at different
// moments; it rehearses a migration, it is no backup.
import type { Driver } from '@yaks/sql'
import {
  type Cell,
  page,
  type Plan,
  plan,
  planFor,
  raised,
  tips,
} from '@yaks/durable-object'

/** The path an object answers a copy on, for the kernel alone. */
export let COPY = '/copy'

/** What a copy asks: the file's plan, or a table's rows past a rowid, up to
 * another when `until` names one. */
export type Asked = { table?: string; after?: number; until?: number }

/** What it is answered: the plan and each table's last rowid, or a page, the
 * columns its rows hold after their rowids, the rowid it ends at (null once
 * the range is read), and whether nothing is left to ask past it. A store
 * that migrates while it is copied answers a page under columns its plan did
 * not name. */
export type Copying =
  | { plan: Plan; tips: Record<string, number> }
  | { rows: Cell[][]; cols: string[]; last: number | null; ended: boolean }

// A page holds up to this many rows, or about this many bytes: each page is
// one request through the kernel, whose gate asks the directory, so a copy
// takes few large pages rather than the relocation protocol's small ones.
let ROWS = 2000
let BYTES = 1024 * 1024

/** One answer to a copy of the object's file: its plan, a page of one of
 * its tables, or a refusal of a table it does not hold, which a file nobody
 * made holds none of. */
export let copying = (sql: Driver, asked: Asked): Response => {
  if (asked.table == null) {
    let made = plan(sql)
    return Response.json({ plan: made, tips: tips(sql, made) })
  }
  let t = planFor(sql, asked.table)
  if (!t) {
    return Response.json({
      error: { code: 'no_table', message: `no table ${asked.table}` },
    }, { status: 404 })
  }
  let { rows, last, ended } = page(
    sql,
    t,
    asked.after ?? 0,
    raised(),
    ROWS,
    BYTES,
    asked.until,
  )
  return Response.json({ rows, cols: t.cols, last, ended } satisfies Copying)
}
