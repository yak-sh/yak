// Work a schema change leaves whose cost grows with rows (D-121389): an index
// over a populated table, a table's refit, filling a text index. The pass that
// brings a file to its schema (./follow.ts) does what costs the same at any
// size and writes the rest down here, in `server_meta` as
// `owed:<kind>:<name>`: a JSON value holding the statements that do it and
// how far it has got. The statements are data, so a process whose vocabulary
// moved on can still finish what an older one owed.
//
// One process at a time works it off ({@link tend}), one window per unit, each
// holding the write lock for about a tenth of a second on the box's copy; on
// the box that is whichever process serves the effects role, under the
// `@yaks/sqlite/schema` lease (packages/cli/host.ts). Opening never waits for
// it, and the graph serves the shape it holds meanwhile: a query runs without
// the index it will have. A window that fails is reported and tried again an
// hour later, and nothing refuses an open on its account.
//
// A file in memory belongs to one process, which has nobody to owe: its work
// is done at once, as it was before any of this.

import {
  and,
  as,
  catalogue,
  col,
  count,
  type CreateIndex,
  type CreateTrigger,
  type Driver,
  eq,
  erect,
  type Expr,
  fn,
  from,
  ge,
  gt,
  le,
  lit,
  lt,
  select,
  type Stmt,
  sub,
  table,
  val,
} from '@yaks/sql/core'
import type { Filler } from '@yaks/fts'
import { META } from './layout.ts'
import { meta } from './meta.ts'
import { unit } from './unit.ts'

/** The prefix of an owed piece of work's `server_meta` key. */
export let OWED = 'owed:'
/** The lease the process working owed work off holds. */
export let SCHEMA_DUTY = '@yaks/sqlite/schema'
/** A table holding this many rows gets a new index as owed work: on the
 * box's copy an index over 10,000 rows builds in about 10 ms, and over its
 * 4,057,139 `created` rows in 2.6 s. */
export let BIG = 10_000
/** The rows one window fills into a text index: 94 ms over the box's
 * `entry_fts`, whose 403,151 rows take 94 s in one `rebuild`. */
export let FILL = 1_000
/** How long a window that failed waits before it is tried again. */
export let RETRY = 3_600_000

/** One piece of owed work. `error` and `next` are a failed window's: what it
 * threw, and when it is tried again. */
export type Owed =
  & { name: string; error?: string; next?: string }
  & (
    /** an index over a table of {@link BIG} rows or more: SQLite builds an
     * index in one statement, so this is the one window that holds the lock
     * for seconds, off the opening path */
    | { kind: 'index'; stmt: CreateIndex }
    /** a text index filled {@link FILL} rows a window from `source`, its
     * triggers keeping the rows `cursor` has passed (@yaks/fts `Filler`) */
    | {
      kind: 'fill'
      source: string
      props: string[]
      triggers: CreateTrigger[]
      cursor: number
    }
  )

let key = (w: Pick<Owed, 'kind' | 'name'>) => `${OWED}${w.kind}:${w.name}`

/** Write `work` down, replacing whatever was owed under its name. */
export let owe = (driver: Driver, work: Owed): void =>
  meta(driver).set(key(work), JSON.stringify(work))

/** Everything this file owes, oldest kind and name first. */
export let owed = (driver: Driver): Owed[] =>
  catalogue(driver).some((o) => o.name == META)
    ? driver.query(select({
      cols: [col('v')],
      from: table(META),
      where: and(ge(col('k'), val(OWED)), lt(col('k'), val('owed;'))),
      order: [col('k')],
    })).map((r) => JSON.parse(String(r.v)) as Owed)
    : []

/** Whether `table` holds at least `n` rows, counting no further than that. */
export let holds = (driver: Driver, name: string, n: number): boolean =>
  Number(
    driver.query(select({
      cols: [as(count(), 'n')],
      from: from(
        select({ cols: [lit(1)], from: table(name), limit: lit(n) }),
        'r',
      ),
    }))[0]?.n ?? 0,
  ) >= n

/**
 * Run `stmts` as `erect` does, owing each index a file lacks over a table of
 * {@link BIG} rows or more instead of building it here.
 */
export let build = (driver: Driver, stmts: readonly Stmt[]): void => {
  let names = new Set(catalogue(driver).map((o) => o.name))
  if (!driver.file || !names.has(META)) return erect(driver, stmts)
  erect(
    driver,
    stmts.filter((s) => {
      if (s.t != 'create index' || names.has(s.name)) return true
      if (!names.has(s.on) || !holds(driver, s.on, BIG)) return true
      owe(driver, { kind: 'index', name: s.name, stmt: s })
      return false
    }),
  )
}

/** What one call to {@link work} did: the work it finished or advanced, or
 * the window that failed. */
export type Worked =
  | { name: string; done: boolean }
  | { name: string; error: unknown }

/**
 * Do one window of the first owed work that is due, in one unit: undefined
 * when nothing is. A window that throws leaves its work as it was, marked to
 * be tried again in an hour, and says why.
 */
export let work = (driver: Driver, now = Date.now()): Worked | undefined => {
  let due = owed(driver).find((w) => !w.next || Date.parse(w.next) <= now)
  if (!due) return
  try {
    return unit(driver, () => ({ name: key(due), done: step(driver, due) }))
  } catch (error) {
    unit(driver, () =>
      owe(driver, {
        ...due,
        error: error instanceof Error ? error.message : String(error),
        next: new Date(now + RETRY).toISOString(),
      }))
    return { name: key(due), error }
  }
}

// One window of `w`, inside its unit; true when the work is finished, and its
// row then gone.
let step = (driver: Driver, w: Owed): boolean => {
  let finish = () => (meta(driver).del(key(w)), true)
  let here = new Map(catalogue(driver).map((o) => [o.name, o]))
  if (w.kind == 'index') {
    // A table a later vocabulary dropped takes its owed index with it.
    if (!here.has(w.stmt.on)) return finish()
    driver.query({ ...w.stmt, ifNot: true })
    return finish()
  }
  // An index a later pass rebuilt whole, or dropped, is no longer this work's.
  let guarded = here.get(w.triggers[0]?.name)?.sql?.includes(key(w))
  if (!here.has(w.name) || !guarded) return finish()
  let rows = (where: Expr) =>
    select({ cols: [col('entity')], from: table(w.source), where })
  let [{ hi }] = driver.query(select({
    cols: [as(fn('max', col('entity')), 'hi')],
    from: from({
      ...rows(gt(col('entity'), lit(w.cursor))),
      order: [col('entity')],
      limit: lit(FILL),
    }, 'w'),
  }))
  if (hi == null) {
    for (let t of w.triggers) {
      driver.query({ t: 'drop', kind: 'trigger', name: t.name, ifExists: true })
    }
    erect(driver, w.triggers)
    return finish()
  }
  driver.query({
    t: 'insert',
    into: w.name,
    cols: ['rowid', ...w.props],
    q: select({
      cols: [
        col('entity'),
        ...w.props.map((p) => fn('coalesce', col(p), lit(''))),
      ],
      from: table(w.source),
      where: and(
        gt(col('entity'), lit(w.cursor)),
        le(col('entity'), lit(Number(hi))),
      ),
    }),
  })
  owe(driver, { ...w, cursor: Number(hi) })
  return false
}

// What a filling index's triggers read its cursor through: the owed row
// itself, so there is one copy of how far it has got. A row that is gone
// reads as every row passed.
let cursorOf = (fts: string): Expr =>
  fn(
    'coalesce',
    sub(select({
      cols: [fn('json_extract', col('v'), lit('$.cursor'))],
      from: table(META),
      where: eq(col('k'), lit(key({ kind: 'fill', name: fts }))),
    })),
    lit(Number.MAX_SAFE_INTEGER),
  )

/**
 * The {@link Filler} @yaks/fts `adopt` hands a new or changed text index to:
 * on a file, an index whose content holds more than one window's rows is owed
 * and filled {@link FILL} rows at a time; a smaller one is rebuilt at once.
 */
export let filler = (driver: Driver): Filler => ({
  pending: (fts) =>
    owed(driver).some((w) => w.kind == 'fill' && w.name == fts)
      ? cursorOf(fts)
      : undefined,
  owe: ({ fts, ...fill }) => {
    let here = catalogue(driver).some((o) => o.name == META)
    if (!driver.file || !here || !holds(driver, fill.source, FILL + 1)) return
    owe(driver, { kind: 'fill', name: fts, ...fill, cursor: 0 })
    return cursorOf(fts)
  },
})

let sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    if (signal.aborted) return done()
    let at = setTimeout(stop, ms)
    function stop() {
      clearTimeout(at)
      signal.removeEventListener('abort', stop)
      done()
    }
    signal.addEventListener('abort', stop)
  })

/**
 * Work off what this file owes until `signal` aborts: a window, a pause as
 * long as the window held the lock so other writers get their turn, and a
 * look every `idle` milliseconds while nothing is due. A failed window is
 * `report`ed and waits its hour.
 */
export let tend = async (
  driver: Driver,
  opts: {
    signal: AbortSignal
    report?: (error: unknown, work: string) => void
    idle?: number
  },
): Promise<void> => {
  let idle = opts.idle ?? 60_000
  while (!opts.signal.aborted) {
    let at = performance.now()
    let did = work(driver)
    if (did && 'error' in did) opts.report?.(did.error, did.name)
    let held = performance.now() - at
    await sleep(did ? Math.max(10, held) : idle, opts.signal)
  }
}
