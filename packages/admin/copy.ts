// `yak admin copy`: a space's Operator store, or every space's, copied into a
// SQLite file on this machine, so a migration over Operator stores is
// rehearsed on copies before it runs (data-migration). Nothing else reaches
// an Operator's file: it stands in its space's Builder object, which the
// kernel reads out for the platform's admin a page at a time
// (workers/yak/store-copy.ts), and each page lands here under its rowids as
// a relocation's far end takes it (@yaks/durable-object's copy protocol). The
// store serves while it is read, so its tables are read at different moments.
// A copy holds people's private words: it is removed once its proof is done.
//
// Several spaces are read at once, and several tables of each: each page
// waits on the platform for a quarter to most of a second, and a store of a
// hundred tables read one page at a time took minutes. A restart interrupts a sweep anyway,
// so a sweep asked again keeps every space it already copied (`kept`).
import {
  arrived,
  type Cell,
  copied,
  ending,
  type Plan,
} from '@yaks/durable-object'
import type { Driver } from '@yaks/sql'
import { Interrupted } from '@yaks/tools/errors'

/** One answer of the door: a space's plan, or a page of one of its tables
 * and the columns its rows hold after their rowids. */
export type Copying =
  | { plan: Plan }
  | { rows: Cell[][]; cols?: string[]; last: number | null; ended?: boolean }

/** A private destination, published on close only after every table arrived. */
export type Target = Driver & { close: (complete: boolean) => void }

// A store migrated while it was copied: a page holds columns its plan did not
// name, so the copy of that space starts over from a plan read again.
class Reshaped extends Error {}

// How many times one space is read from its plan before its copy fails: a
// store migrates once a deploy, so one more is enough.
const TRIES = 3

// How many spaces are copied at once, and how many of a space's tables.
export const LANES = 8
export const TABLES = 8

// `fn` over the items `n` at a time, every lane settled before it answers, so
// nothing is still writing once it does. Once `fn` fails the lanes take no
// more, `stopped` tells the items in flight, and the first failure that is
// not an interruption is thrown.
let settled = async <T>(
  items: T[],
  n: number,
  fn: (item: T, stopped: () => boolean) => Promise<unknown>,
) => {
  let next = 0, failed = false
  let stopped = () => failed
  let lane = async () => {
    while (next < items.length) {
      try {
        await fn(items[next++], stopped)
      } catch (error) {
        failed = true
        next = items.length
        throw error
      }
    }
  }
  let ended = await Promise.allSettled(Array.from({ length: n }, lane))
  let first =
    ended.find((e) =>
      e.status == 'rejected' && !(e.reason instanceof Interrupted)
    ) ?? ended.find((e) => e.status == 'rejected')
  if (first) throw (first as PromiseRejectedResult).reason
}

/** Each space's store into the file `open` makes for its slug, a line said
 * for each: its tables and rows, that it holds none, or that it was `kept`,
 * copied already, and is not read again. The file is one, to be copied or
 * opened anywhere: `open` makes it with a rollback journal. `lanes` spaces
 * are copied at once. A copy stops at the next page once `stopping` aborts,
 * as its process drains, which waits for it, and once one space fails, the
 * others stop the same way. A space whose store migrates while it is read is
 * copied again from its new plan. */
export let copy = async (o: {
  spaces: { eid: string; slug: string }[]
  page: (
    space: string,
    asked: { table?: string; after?: number },
  ) => Promise<Copying>
  open: (slug: string) => Target
  out: (line: string) => unknown
  stopping: AbortSignal
  kept?: (slug: string) => boolean
  lanes?: number
  tables?: number
}) => {
  let failed = false, done = 0
  let going = () => {
    if (o.stopping.aborted || failed) {
      throw new Interrupted(
        `the copy was interrupted with ${done} of ${o.spaces.length} spaces copied`,
      )
    }
  }
  let once = async (space: { eid: string; slug: string }) => {
    going()
    if (o.kept?.(space.slug)) return `${space.slug}  kept: copied already`
    let asked = await o.page(space.eid, {})
    going()
    let plan = (asked as { plan?: Plan } | null)?.plan
    if (!plan) {
      throw new Error(
        `its plan was answered ${JSON.stringify(asked).slice(0, 300)}`,
      )
    }
    if (!plan.tables.length) return `${space.slug}  no store`
    let sql = o.open(space.slug)
    let rows = 0, complete = false
    try {
      copied(sql, plan)
      await settled(plan.tables, o.tables ?? TABLES, async (t, stopped) => {
        for (let after = 0;;) {
          going()
          if (stopped()) throw new Interrupted(`${space.slug}'s copy stopped`)
          let next = await o.page(space.eid, { table: t.name, after }) as {
            rows: Cell[][]
            cols?: string[]
            last: number | null
            ended?: boolean
          }
          going()
          if (stopped()) throw new Interrupted(`${space.slug}'s copy stopped`)
          if (next.cols && next.cols.join() != t.cols.join()) {
            throw new Reshaped(
              `${space.slug}'s ${t.name} changed from (${t.cols}) to (${next.cols}) while it was copied`,
            )
          }
          if (next.last == null) break
          arrived(sql, t, next.rows)
          rows += next.rows.length
          if (next.ended) break
          after = next.last
        }
      })
      ending(sql, plan)
      complete = true
    } finally {
      sql.close(complete)
    }
    return `${space.slug}  ${plan.tables.length} tables, ${rows} rows`
  }
  let tries = async (space: { eid: string; slug: string }) => {
    for (let tried = 1;; tried++) {
      try {
        return await once(space)
      } catch (error) {
        if (error instanceof Reshaped && tried < TRIES) continue
        // A sweep's failure names the space it failed on.
        if (error instanceof Error && !(error instanceof Interrupted)) {
          error.message = `${space.slug}: ${error.message}`
        }
        throw error
      }
    }
  }
  // The failure that stopped the copy, not the lanes it stopped after it.
  await settled(o.spaces, o.lanes ?? LANES, async (space) => {
    try {
      await o.out(await tries(space))
      done++
    } catch (error) {
      failed = true
      throw error
    }
  })
}
