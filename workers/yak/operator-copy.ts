// A space's Operator store, read out for the platform's admin a page at a
// time, so a migration over Operator stores is rehearsed on copies before it
// runs (`yak admin copy`). The Builder's object holds the store, and nothing
// else reaches its file: the store mover and the relocation copy are an app
// store's. A copy is what the file holds, every table under its own rowids
// (@yaks/durable-object's copy protocol), read while the store serves, so
// tables read at different moments; it rehearses a migration, it is no backup.
import type { Driver } from '@yaks/sql'
import { type Cell, page, type Plan, plan, raised } from '@yaks/durable-object'

/** The path the Builder answers a copy on, for the kernel alone. */
export let COPY = '/copy'

/** What a copy asks: the file's plan, or a table's rows past a rowid. */
export type Asked = { table?: string; after?: number }

/** What it is answered: the plan, or a page and the rowid it ends at (null
 * once the table is read). */
export type Copying = { plan: Plan } | { rows: Cell[][]; last: number | null }

/** One answer to a copy of the object's file. */
export let copying = (sql: Driver, asked: Asked): Copying => {
  let made = plan(sql)
  if (asked.table == null) return { plan: made }
  let t = made.tables.find((t) => t.name == asked.table)
  if (!t) throw new Error(`no table ${asked.table}`)
  let { rows, last } = page(sql, t, asked.after ?? 0, raised())
  return { rows, last }
}
