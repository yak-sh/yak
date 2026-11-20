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
// Several spaces are read at once, and a space's tables, and a long table's
// rows in ranges: each page waits on the platform for half a second, and a
// store of 168 tables read one page at a time took a minute and a half. A
// restart interrupts a sweep anyway, so a sweep asked again keeps every space
// it already copied (`kept`).
import {
  arrived,
  type Cell,
  copied,
  ending,
  type Plan,
} from '@yaks/durable-object'
import type { Driver } from '@yaks/sql'
import { Interrupted } from '@yaks/tools/errors'

/** One answer of the door: a space's plan and each table's last rowid, or
 * a page of one of its tables and the columns its rows hold after their
 * rowids. A door that names no tips, or no `ended`, is read a page at a time
 * to an empty page. */
export type Copying =
  | { plan: Plan; tips?: Record<string, number> }
  | { rows: Cell[][]; cols?: string[]; last: number | null; ended?: boolean }

/** What a copy asks: a store's plan, or a table's rows past a rowid, up to
 * another when `until` names one. */
export type Asked = { table?: string; after?: number; until?: number }

type Tips = Record<string, number>

/** A private destination, published on close only after every table arrived. */
export type Target = Driver & { close: (complete: boolean) => void }

// A store migrated while it was copied: a page holds columns its plan did not
// name, so the copy of that space starts over from a plan read again.
class Reshaped extends Error {}

// How many times one space is read from its plan before its copy fails: a
// store migrates once a deploy, so one more is enough.
const TRIES = 3

// How many spaces are copied at once, how many pages are asked at once
// across them, and how many ranges a long table is read in.
export const LANES = 8
export const PAGES = 16
export const RANGES = 8

// `fn` over the items `n` at a time, every lane settled before it answers, so
// nothing is still writing once it does. Once `fn` fails the lanes take no
// more, and the first failure that is not an interruption is thrown.
let settled = async <T>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<unknown>,
) => {
  let next = 0
  let lane = async () => {
    while (next < items.length) {
      try {
        await fn(items[next++])
      } catch (error) {
        next = items.length
        throw error
      }
    }
  }
  thrown(await Promise.allSettled(Array.from({ length: n }, lane)))
}

// The failure that stopped the others, not the interruptions it caused.
let thrown = (ended: PromiseSettledResult<unknown>[]) => {
  let first =
    ended.find((e) =>
      e.status == 'rejected' && !(e.reason instanceof Interrupted)
    ) ?? ended.find((e) => e.status == 'rejected')
  if (first) throw (first as PromiseRejectedResult).reason
}

// At most `n` of what is handed it run at once; the rest wait their turn.
let gated = (n: number) => {
  let free = n
  let waiting: (() => void)[] = []
  return async <T>(run: () => Promise<T>): Promise<T> => {
    if (free) free--
    else await new Promise<void>((turn) => waiting.push(turn))
    try {
      return await run()
    } finally {
      let next = waiting.shift()
      if (next) next()
      else free++
    }
  }
}

// The rowid ranges (last, end] is read in, sized by the page that covered
// (after, last], at most `most` of them. The final one ends at `until`, which
// a table's own read leaves open, for rows written while the copy reads.
export let ranges = (
  after: number,
  last: number,
  end: number,
  most: number,
  until?: number,
) => {
  let pages = Math.ceil((end - last) / Math.max(1, last - after))
  let n = Math.max(1, Math.min(most, pages))
  let span = Math.ceil((end - last) / n)
  return Array.from({ length: n }, (_, i) => ({
    after: last + i * span,
    until: i == n - 1 ? until : last + (i + 1) * span,
  }))
}

/** Each space's store into the file `open` makes for its slug, a line said
 * for each: its tables and rows, that it holds none, or that it was `kept`,
 * copied already, and is not read again. The file is one, to be copied or
 * opened anywhere: `open` makes it with a rollback journal. `lanes` spaces
 * are copied at once, `pages` pages asked at once across them, and a long
 * table is read in up to `ranges` ranges. A copy stops at the next page once `stopping` aborts,
 * as its process drains, which waits for it, and once one space fails, the
 * others stop the same way. A space whose store migrates while it is read is
 * copied again from its new plan. */
export let copy = async (o: {
  spaces: { eid: string; slug: string }[]
  page: (space: string, asked: Asked) => Promise<Copying>
  open: (slug: string) => Target
  out: (line: string) => unknown
  stopping: AbortSignal
  kept?: (slug: string) => boolean
  lanes?: number
  pages?: number
  ranges?: number
}) => {
  let failed = false, done = 0
  let gate = gated(o.pages ?? PAGES)
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
    let asked = await gate(() => o.page(space.eid, {}))
    going()
    let { plan, tips } = (asked ?? {}) as { plan?: Plan; tips?: Tips }
    if (!plan) {
      throw new Error(
        `its plan was answered ${JSON.stringify(asked).slice(0, 300)}`,
      )
    }
    if (!plan.tables.length) return `${space.slug}  no store`
    let sql = o.open(space.slug)
    let rows = 0, complete = false, broke = false
    let reading = () => {
      going()
      if (broke) throw new Interrupted(`${space.slug}'s copy stopped`)
    }
    // A range of a table read a page at a time. Once a page says how dense
    // its rows run, what is left of the range, to its end or the table's
    // tip, is split into ranges read at once, each sized again by its own
    // first page.
    let read = async (
      t: Plan['tables'][number],
      after: number,
      until?: number,
    ): Promise<void> => {
      for (;;) {
        reading()
        let next = await gate(() =>
          o.page(space.eid, { table: t.name, after, until })
        ) as Extract<Copying, { rows: unknown }>
        reading()
        if (next.cols && next.cols.join() != t.cols.join()) {
          throw new Reshaped(
            `${space.slug}'s ${t.name} changed from (${t.cols}) to (${next.cols}) while it was copied`,
          )
        }
        if (next.last == null) return
        arrived(sql, t, next.rows)
        rows += next.rows.length
        if (next.ended) return
        let end = until ?? tips?.[t.name] ?? 0
        let parts = end > next.last
          ? ranges(after, next.last, end, o.ranges ?? RANGES, until)
          : []
        if (parts.length > 1) {
          return all(parts.map((r) => read(t, r.after, r.until)))
        }
        after = next.last
      }
    }
    let all = async (reads: Promise<void>[]) => {
      let ended = await Promise.allSettled(reads.map((r) =>
        r.catch((error) => {
          broke = true
          throw error
        })
      ))
      thrown(ended)
    }
    try {
      copied(sql, plan)
      await all(plan.tables.map((t) => read(t, 0)))
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
