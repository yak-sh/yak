// A store's file read out for the platform's admin a page at a time, so a
// migration is rehearsed on copies before it runs (`yak admin copy`): a
// space's Operator store, which its Builder's object holds (build.ts), or an
// app's store, which its Store object holds (graph.ts). A copy is what the
// file holds, every table under its own rowids (@yaks/durable-object's copy
// protocol), read while the store serves, so tables read at different
// moments; it rehearses a migration, it is no backup.
import type { Driver } from '@yaks/sql'
import { type Cell, page, type Plan, plan, raised } from '@yaks/durable-object'

/** The path an object answers a copy on, for the kernel alone. */
export let COPY = '/copy'

/** What a copy asks: the file's plan, or a table's rows past a rowid. */
export type Asked = { table?: string; after?: number }

/** What it is answered: the plan, or a page and the rowid it ends at (null
 * once the table is read). */
export type Copying = { plan: Plan } | { rows: Cell[][]; last: number | null }

// A page holds up to this many rows, or about this many bytes: each page is
// one request through the kernel, whose gate asks the directory, so a copy
// takes few large pages rather than the relocation protocol's small ones.
let ROWS = 2000
let BYTES = 1024 * 1024

/** One answer to a copy of the object's file: its plan, a page of one of
 * its tables, or a refusal of a table it does not hold, which a file nobody
 * made holds none of. */
export let copying = (sql: Driver, asked: Asked): Response => {
  let made = plan(sql)
  if (asked.table == null) return Response.json({ plan: made })
  let t = made.tables.find((t) => t.name == asked.table)
  if (!t) {
    return Response.json({
      error: { code: 'no_table', message: `no table ${asked.table}` },
    }, { status: 404 })
  }
  let { rows, last } = page(sql, t, asked.after ?? 0, raised(), ROWS, BYTES)
  return Response.json({ rows, last } satisfies Copying)
}
