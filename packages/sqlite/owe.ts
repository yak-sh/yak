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
  type CreateTable,
  type CreateTrigger,
  type Driver,
  eq,
  erect,
  type Expr,
  fn,
  from,
  ge,
  gt,
  type Insert,
  le,
  lit,
  lt,
  type SchemaObject,
  select,
  type Stmt,
  sub,
  table,
  val,
} from '@yaks/sql/core'
import type { Filler } from '@yaks/fts'
import { carried, type Refitting } from './ddl.ts'
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
/** The rows one window copies into a table being rebuilt: 5.6 ms for 20,000
 * of the box's `created`, whose rebuild in one unit holds the lock 10.2 s. */
export let COPY = 20_000
/** The rows one window deletes from a rebuilt table's old rows: about 65 ms
 * on the box's copy. */
export let CLEAR = 10_000
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
    /** a table of {@link BIG} rows or more whose constraints moved, rebuilt
     * beside itself as `table` ({@link building}): {@link COPY} rows a
     * window, triggers keeping the rows `cursor` has passed, then swapped in
     * by name in one unit, which raises `after` (the indexes and triggers
     * that stood on it) on the new one */
    | {
      kind: 'refit'
      table: CreateTable
      cols: string[]
      changed: Refitting['changed']
      after: Stmt[]
      cursor: number
    }
    /** the rows a refit left in its old table, deleted {@link CLEAR} a
     * window, then the table */
    | { kind: 'clear' }
  )

let key = (w: Pick<Owed, 'kind' | 'name'>) => `${OWED}${w.kind}:${w.name}`

/** Write `work` down, replacing whatever was owed under its name. */
export let owe = (driver: Driver, work: Owed): void =>
  meta(driver).set(key(work), JSON.stringify(work))

// The order owed work is done in: a missing index first, since queries run
// without it meanwhile, and a rebuilt table's old rows last, since nothing
// reads them.
let order: Owed['kind'][] = ['index', 'fill', 'refit', 'clear']

/** Everything this file owes, in the order it is worked off, then by name. */
export let owed = (driver: Driver): Owed[] =>
  catalogue(driver).some((o) => o.name == META)
    ? driver.query(select({
      cols: [col('v')],
      from: table(META),
      where: and(ge(col('k'), val(OWED)), lt(col('k'), val('owed;'))),
      order: [col('k')],
    })).map((r) => JSON.parse(String(r.v)) as Owed)
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
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

// The highest id among the next `n` rows of `source` past `cursor`, or null
// when there are none: where the window that takes them ends.
let next = (driver: Driver, source: string, cursor: number, n: number) => {
  let [{ hi }] = driver.query(select({
    cols: [as(fn('max', col('entity')), 'hi')],
    from: from(
      select({
        cols: [col('entity')],
        from: table(source),
        where: gt(col('entity'), lit(cursor)),
        order: [col('entity')],
        limit: lit(n),
      }),
      'w',
    ),
  }))
  return hi == null ? null : Number(hi)
}

// The rows of `source` a window takes: past `cursor`, up to `hi`.
let window = (cursor: number, hi: number) =>
  and(gt(col('entity'), lit(cursor)), le(col('entity'), lit(hi)))

// What the triggers of work being done behind a cursor read it through: the
// owed row itself, so there is one copy of how far it has got. A row that is
// gone reads as every row passed.
let cursorOf = (w: Pick<Owed, 'kind' | 'name'>): Expr =>
  fn(
    'coalesce',
    sub(select({
      cols: [fn('json_extract', col('v'), lit('$.cursor'))],
      from: table(META),
      where: eq(col('k'), lit(key(w))),
    })),
    lit(Number.MAX_SAFE_INTEGER),
  )

/** The name a table is rebuilt under, and the name its old rows wait under
 * to be cleared. Neither is a component table (./physical.ts). */
export let building = (comp: string): string => `_yaks_refit_${comp}`
export let leaving = (comp: string): string => `_yaks_old_${comp}`

// The triggers keeping a table being rebuilt in step with the rows its cursor
// has passed: a write behind the cursor is written to it too, and one ahead is
// read when its window comes.
let steps = (comp: string, w: Extract<Owed, { kind: 'refit' }>) => {
  let into = w.table.name
  let r = { changed: w.changed } as Refitting
  let passed = (row: string) => le(col('entity', row), cursorOf(w))
  let put: Insert = {
    t: 'insert',
    or: 'replace',
    into,
    cols: w.cols,
    rows: [w.cols.map((c) => carried(r, c, 'new'))],
  }
  let trigger = (
    event: CreateTrigger['event'],
    body: CreateTrigger['body'],
  ): CreateTrigger => ({
    t: 'create trigger',
    name: `${into}_${event}`,
    ifNot: true,
    timing: 'after',
    event,
    on: comp,
    when: passed(event == 'delete' ? 'old' : 'new'),
    body,
  })
  return [
    trigger('insert', [put]),
    trigger('update', [put]),
    trigger('delete', [{
      t: 'delete',
      from: into,
      where: eq(col('entity'), col('entity', 'old')),
    }]),
  ]
}

// Give up rebuilding a table: the triggers keeping the new one in step, and
// the new one. A table its vocabulary dropped has taken the triggers already.
let quit = (driver: Driver, w: Extract<Owed, { kind: 'refit' }>) => {
  for (let t of steps(w.name, w)) {
    driver.query({ t: 'drop', kind: 'trigger', name: t.name, ifExists: true })
  }
  driver.query({ t: 'drop', kind: 'table', name: w.table.name, ifExists: true })
}

// Each kind's window, inside its unit; true when the work is finished, and
// its row then gone.
let windows: {
  [K in Owed['kind']]: (
    driver: Driver,
    w: Extract<Owed, { kind: K }>,
    here: Map<string, SchemaObject>,
  ) => boolean
} = {
  index: (driver, w, here) => {
    // A table a later vocabulary dropped takes its owed index with it.
    if (here.has(w.stmt.on)) driver.query({ ...w.stmt, ifNot: true })
    return true
  },
  fill: (driver, w, here) => {
    // An index a later pass rebuilt whole, or dropped, is no longer this
    // work's.
    let guarded = here.get(w.triggers[0]?.name)?.sql?.includes(key(w))
    if (!here.has(w.name) || !guarded) return true
    let hi = next(driver, w.source, w.cursor, FILL)
    if (hi == null) {
      for (let t of w.triggers) {
        driver.query({
          t: 'drop',
          kind: 'trigger',
          name: t.name,
          ifExists: true,
        })
      }
      erect(driver, w.triggers)
      return true
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
        where: window(w.cursor, hi),
      }),
    })
    owe(driver, { ...w, cursor: hi })
    return false
  },
  refit: (driver, w, here) => {
    let comp = w.name, into = w.table.name, old = leaving(comp)
    if (!here.has(comp) || !here.has(into)) return quit(driver, w), true
    let hi = next(driver, comp, w.cursor, COPY)
    if (hi != null) {
      let r = { changed: w.changed } as Refitting
      driver.query({
        t: 'insert',
        into,
        cols: w.cols,
        q: select({
          cols: w.cols.map((c) => carried(r, c, comp)),
          from: table(comp),
          where: window(w.cursor, hi),
        }),
      })
      owe(driver, { ...w, cursor: hi })
      return false
    }
    // Every row is across: the swap, in this one unit.
    if (here.has(old)) throw new Error(`${comp} waits for ${old} to clear`)
    let filling = owed(driver).find((o) =>
      o.kind == 'fill' && o.triggers.some((t) => t.on == comp)
    )
    if (filling) throw new Error(`${comp} waits for ${filling.name} to fill`)
    for (let o of here.values()) {
      if (o.tbl_name != comp || o.sql == null) continue
      if (o.type != 'trigger' && o.type != 'index') continue
      driver.query({ t: 'drop', kind: o.type, name: o.name })
    }
    // Renamed without rewriting the views and triggers that name the table,
    // which name the new one once it holds the name.
    let legacy = (value: string) =>
      driver.query({ t: 'pragma', name: 'legacy_alter_table', value })
    legacy('on')
    try {
      driver.query({ t: 'alter table', table: comp, rename: old })
      driver.query({ t: 'alter table', table: into, rename: comp })
    } finally {
      legacy('off')
    }
    // An index over the rows is built in a window of its own.
    build(driver, w.after)
    owe(driver, { kind: 'clear', name: old })
    return true
  },
  clear: (driver, w, here) => {
    if (!here.has(w.name)) return true
    let hi = next(driver, w.name, Number.MIN_SAFE_INTEGER, CLEAR)
    if (hi == null) {
      driver.query({ t: 'drop', kind: 'table', name: w.name })
      return true
    }
    driver.query({
      t: 'delete',
      from: w.name,
      where: le(col('entity'), lit(hi)),
    })
    return false
  },
}

// One window of `w`, inside its unit; true when the work is finished, and its
// row then gone.
let step = (driver: Driver, w: Owed): boolean => {
  let here = new Map(catalogue(driver).map((o) => [o.name, o]))
  let done = (windows[w.kind] as (
    d: Driver,
    w: Owed,
    h: Map<string, SchemaObject>,
  ) => boolean)(driver, w, here)
  if (done) meta(driver).del(key(w))
  return done
}

/**
 * The {@link Filler} @yaks/fts `adopt` hands a new or changed text index to:
 * on a file, an index whose content holds more than one window's rows is owed
 * and filled {@link FILL} rows at a time; a smaller one is rebuilt at once.
 */
export let filler = (driver: Driver): Filler => ({
  pending: (fts) =>
    owed(driver).some((w) => w.kind == 'fill' && w.name == fts)
      ? cursorOf({ kind: 'fill', name: fts })
      : undefined,
  owe: ({ fts, ...fill }) => {
    let here = catalogue(driver).some((o) => o.name == META)
    if (!driver.file || !here || !holds(driver, fill.source, FILL + 1)) return
    owe(driver, { kind: 'fill', name: fts, ...fill, cursor: 0 })
    return cursorOf({ kind: 'fill', name: fts })
  },
})

/**
 * Take on rebuilding `comp` as `r` says, on a file where it holds {@link BIG}
 * rows or more: the table it is built as and the triggers keeping it in step,
 * made now, and the copying owed. `after` is what to raise on the new table
 * once it holds the name: the indexes and triggers the composed schema puts
 * on it. A rebuild already under way to the same shape carries on, with this
 * `after`; one to another shape is abandoned first. False where the table is
 * small enough to rebuild at once.
 */
export let reshape = (
  driver: Driver,
  comp: string,
  r: Refitting,
  after: Stmt[],
): boolean => {
  let names = new Set(catalogue(driver).map((o) => o.name))
  if (!driver.file || !names.has(META) || !holds(driver, comp, BIG)) {
    return false
  }
  let table = { ...r.fresh, name: building(comp), ifNot: true }
  let was = owed(driver).find((w) => w.kind == 'refit' && w.name == comp)
  if (
    was?.kind == 'refit' && JSON.stringify(was.table) == JSON.stringify(table)
  ) {
    owe(driver, { ...was, after })
    return true
  }
  let w: Owed = {
    kind: 'refit',
    name: comp,
    table,
    cols: r.cols,
    changed: r.changed,
    after,
    cursor: 0,
  }
  quit(driver, w)
  driver.query(table)
  owe(driver, w)
  for (let t of steps(comp, w)) driver.query(t)
  return true
}

/** Give up every table rebuild owed but those of `kept`: a pass that took on
 * no rebuild of a table found it fits its vocabulary again, or cannot be
 * rebuilt (./ddl.ts `fit`). */
export let forgo = (driver: Driver, kept: Set<string>): void => {
  for (let w of owed(driver)) {
    if (w.kind != 'refit' || kept.has(w.name)) continue
    quit(driver, w)
    meta(driver).del(key(w))
  }
}

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
