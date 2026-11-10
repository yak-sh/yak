// `yak admin copy`: a space's Operator store, or every space's, copied into a
// SQLite file on this machine, so a migration over Operator stores is
// rehearsed on copies before it runs (data-migration). Nothing else reaches
// an Operator's file: it stands in its space's Builder object, which the
// kernel reads out for the platform's admin a page at a time
// (workers/yak/operator-copy.ts), and each page lands here under its rowids as
// a relocation's far end takes it (@yaks/durable-object's copy protocol). The
// store serves while it is read, so its tables are read at different moments.
// A copy holds people's private words: it is removed once its proof is done.
import {
  arrived,
  type Cell,
  copied,
  ending,
  type Plan,
} from '@yaks/durable-object'
import type { Driver } from '@yaks/sql'

/** One answer of the door: a space's plan, or a page of one of its tables. */
export type Copying = { plan: Plan } | { rows: Cell[][]; last: number | null }

/** Each space's store into the file `open` makes for its slug, a line said
 * for each: its tables and rows, or that it holds none. */
export let copy = async (o: {
  spaces: { eid: string; slug: string }[]
  page: (
    space: string,
    asked: { table?: string; after?: number },
  ) => Promise<Copying>
  open: (slug: string) => Driver & { close: () => void }
  out: (line: string) => void
  stopping: AbortSignal
}) => {
  for (let space of o.spaces) {
    if (o.stopping.aborted) break
    let { plan } = await o.page(space.eid, {}) as { plan: Plan }
    if (!plan.tables.length) {
      o.out(`${space.slug}  no store`)
      continue
    }
    let sql = o.open(space.slug)
    try {
      copied(sql, plan)
      let rows = 0
      for (let t of plan.tables) {
        for (let after = 0;;) {
          let next = await o.page(space.eid, { table: t.name, after }) as {
            rows: Cell[][]
            last: number | null
          }
          if (next.last == null) break
          arrived(sql, t, next.rows)
          rows += next.rows.length
          after = next.last
        }
      }
      ending(sql, plan)
      o.out(`${space.slug}  ${plan.tables.length} tables, ${rows} rows`)
    } finally {
      sql.close()
    }
  }
}
