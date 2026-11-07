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
// The same process does a file's upkeep ({@link Daily}): the planner
// statistics an install or the day owes, a table a window, and
// whatever a host adds, such as the box's check of its text indexes. It also
// gives back the pages a bulk delete freed ({@link reclaim}), so the file
// shrinks without a VACUUM. Opening does none of it.
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
  op,
  over,
  type SchemaObject,
  select,
  type Stmt,
  sub,
  table,
  val,
} from '@yaks/sql/core'
import type { Filler } from '@yaks/fts'
import {
  analyzed,
  analyzing,
  carried,
  counted,
  type Refitting,
  tallied,
  tally,
} from './ddl.ts'
import { META } from './layout.ts'
import { analyzedAt, installation, meta } from './meta.ts'
import { unit } from './unit.ts'

/** The prefix of an owed piece of work's `server_meta` key. */
export let OWED = 'owed:'
/** The lease the process working owed work off holds. */
export let SCHEMA_DUTY = '@yaks/sqlite/schema'
/** A table holding this many rows gets a new index as owed work: on the
 * box's copy an index over 10,000 rows builds in about 10 ms, and over its
 * 4,057,139 `created` rows in 2.6 s. */
export let BIG = 10_000
/** The rows one window fills into a text index. Its time goes on the text,
 * not the rows: on the box's copy, whose `entry_fts` bodies run about 5 KB,
 * 1,000 rows took 164 ms a window and up to 515 ms, and its 356,025 rows
 * take 39 s in one `rebuild`. */
export let FILL = 500
/** The text one window fills into a text index, past its first row: a
 * substring index (@yaks/fts `contains`) takes about 190 ms a MiB, and 500 of
 * the box's transcript texts held a window for up to 6.8 s. */
export let FILL_TEXT = 1 << 20
/** The rows one window copies into a table being rebuilt: 5.6 ms for 20,000
 * of the box's `created`, whose rebuild in one unit holds the lock 10.2 s. */
export let COPY = 20_000
/** The rows one window deletes from a rebuilt table's old rows: about 65 ms
 * on the box's copy. */
export let CLEAR = 10_000
/** The rows one window counts of a table whose statistics are its row count
 * (./ddl.ts `counted`): one leaf page a row at worst, so 2 MB of the box's
 * 4 KiB pages. On its 10 GB file under a load of 25, a window over a text
 * index's data took 0.1 to 0.9 s, where `ANALYZE` read a whole table in one
 * window and held the write lock 20.4 s (bug bace8585). */
export let COUNT = 500
/** The free pages a file keeps for its next writes to reuse; past these,
 * {@link reclaim} gives the rest back. 64 MiB of the box's 4 KiB pages. */
export let SLACK = 16_384
/** The pages one window gives back: on a 660 MB file of 4 KiB pages with a
 * third of its rows deleted in runs, 1,000 pages took 28 ms a window, and up
 * to 176 ms with the checkpoint that followed. */
export let RECLAIM = 1_000
/** The sizes above as one value, which what chooses by them takes, so a
 * test can shrink them instead of building the rows. */
export type Sizes = {
  big: number
  fill: number
  fillText: number
  copy: number
  clear: number
  slack: number
  reclaim: number
  count: number
}
export let SIZES: Sizes = {
  big: BIG,
  fill: FILL,
  fillText: FILL_TEXT,
  copy: COPY,
  clear: CLEAR,
  slack: SLACK,
  reclaim: RECLAIM,
  count: COUNT,
}
/** How long a window that failed waits before it is tried again. */
export let RETRY = 3_600_000
/** How often a file's upkeep ({@link Daily}) is done. */
export let DAY = 86_400_000

/** One piece of owed work. `error` and `next` are a failed window's: what it
 * threw, and when it is tried again. */
export type Owed =
  & { name: string; error?: string; next?: string }
  & (
    /** an index over a table of {@link BIG} rows or more: SQLite builds an
     * index in one statement, so this is the one window that holds the lock
     * for seconds, off the opening path */
    | { kind: 'index'; stmt: CreateIndex }
    /** a text index filled {@link FILL} rows and {@link FILL_TEXT} of text a
     * window from `source`, its
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

/** Whether the engine refused a unique index because rows already in its
 * table share a key. */
let collides = (e: unknown): boolean =>
  e instanceof Error && /unique constraint failed/i.test(e.message)

/** What is reported of a unique index the rows in its table break: it is not
 * built, and the table serves without it. */
export let unbuilt = (s: CreateIndex, e: unknown): Error =>
  new Error(
    `${s.name} is not built: rows in ${s.on} share its key and need a ` +
      `migration that prepares them (${e instanceof Error ? e.message : e})`,
    { cause: e },
  )

/**
 * Run `stmts` as `erect` does, owing each index a file lacks over a table of
 * {@link BIG} rows or more instead of building it here. A new unique index the
 * rows already in its table break is left unbuilt and returned, so the file
 * opens with the shape it holds and the caller reports it; a failed statement
 * undoes only itself, so the rest stands.
 */
export let build = (
  driver: Driver,
  stmts: readonly Stmt[],
  sizes: Sizes = SIZES,
): Error[] => {
  let names = new Set(catalogue(driver).map((o) => o.name))
  let owing = !!driver.file && names.has(META)
  let now = stmts.filter((s) => {
    if (!owing || s.t != 'create index' || names.has(s.name)) return true
    if (!names.has(s.on) || !holds(driver, s.on, sizes.big)) return true
    owe(driver, { kind: 'index', name: s.name, stmt: s })
    return false
  })
  let unique = (s: Stmt): s is CreateIndex =>
    s.t == 'create index' && !!s.unique && !names.has(s.name)
  erect(driver, now.filter((s) => !unique(s)))
  return now.filter(unique).flatMap((s) => {
    try {
      driver.query(s)
      return []
    } catch (e) {
      if (!collides(e)) throw e
      return [unbuilt(s, e)]
    }
  })
}

/** What one call to {@link work} did: the work it finished or advanced, or
 * the window that failed. */
export type Worked =
  | { name: string; done: boolean }
  | { name: string; error: unknown }

/**
 * Upkeep whoever tends a file does once a day, after what it owes: planner
 * statistics ({@link statistics}) always, and what a host adds, the way the
 * box checks that its text indexes hold every row (@yaks/fts `heal`). `run`
 * is one window, in one unit. When each is next due is kept in `server_meta`
 * as `daily:<name>`.
 */
export type Daily = { name: string; run: (driver: Driver) => void }

let DAILY = 'daily:'

/**
 * Work a host's rows owe rather than its schema, found in them each time it
 * is looked for: the box makes the pieces of its long texts' substring index
 * this way (@yaks/fts `pieces`). `run` is one window, in one unit, and
 * answers whether it found any to do. One that throws is put off an hour, as
 * `chore:<name>` in `server_meta`.
 */
export type Chore = { name: string; run: (driver: Driver) => boolean }

let CHORE = 'chore:'

// One window of the first of `chores` that is not put off and finds work to
// do; one that throws is put off an hour.
let chore = (
  driver: Driver,
  chores: Chore[],
  now: number,
): Worked | undefined => {
  let m = meta(driver)
  for (let c of chores) {
    let name = CHORE + c.name
    let at = m.get(name)
    if (at && Date.parse(at) > now) continue
    try {
      let did = unit(driver, () => {
        if (at) m.del(name)
        return c.run(driver)
      })
      if (did) return { name, done: false }
    } catch (error) {
      unit(driver, () => m.set(name, new Date(now + RETRY).toISOString()))
      return { name, error }
    }
  }
}

/** Planner statistics (./ddl.ts `analyzed`): due once a day, and as soon as
 * an index or a rebuilt table is in place, when the tables that lack them, or
 * all that hold rows once the file has grown tenfold, are owed an analysis,
 * which {@link work} does a table a window. */
export let statistics: Daily = {
  name: 'statistics',
  run: (driver) => {
    let receipt = installation(driver)
    let owed = analyzed(driver, receipt?.statistics)
    if (owed && receipt) analyzedAt(driver, receipt.schema, owed)
  },
}

/** The `server_meta` key of {@link analyze}: when it is next tried, after a
 * window that failed. */
export let ANALYZING = 'analyze'

/**
 * Take one window of the statistics of the first table the receipt owes them,
 * and answer how many stay owed; undefined when none is. A table that is
 * counted (./ddl.ts `counted`) has `count` rows read in a snapshot, holding
 * no lock, and the receipt written after in a unit of its own; any other is
 * analyzed in its own unit.
 */
export let analyze = (
  driver: Driver,
  count: number = COUNT,
): number | undefined => {
  let window = unit(driver, () => {
    let statistics = installation(driver)?.statistics
    let first = statistics?.owed?.[0]
    if (first == null || !counted(driver, first)) return
    return tally(driver, statistics!, count)
  }, 'read')
  return unit(driver, () => {
    let receipt = installation(driver)
    let statistics = receipt?.statistics
    if (!receipt || !statistics?.owed?.length) return
    let next = !counted(driver, statistics.owed[0])
      ? analyzing(driver, statistics, 1)
      : window
      ? tallied(driver, statistics, window)
      : statistics
    if (next != statistics) analyzedAt(driver, receipt.schema, next)
    return next.owed?.length ?? 0
  })
}

// One window of the planner statistics the receipt owes; one that throws is
// put off an hour.
let analysis = (
  driver: Driver,
  now: number,
  sizes: Sizes,
): Worked | undefined => {
  if (!installation(driver)?.statistics?.owed?.length) return
  let at = meta(driver).get(ANALYZING)
  if (at && Date.parse(at) > now) return
  try {
    let left = analyze(driver, sizes.count)
    return left == null ? undefined : { name: ANALYZING, done: !left }
  } catch (error) {
    unit(
      driver,
      () => meta(driver).set(ANALYZING, new Date(now + RETRY).toISOString()),
    )
    return { name: ANALYZING, error }
  }
}

/**
 * Do one window, in one unit: of the first owed work that is due, else of
 * the first of `chores` with work to do, else of the first table owed an
 * analysis ({@link analyze}), else of giving free pages back
 * ({@link reclaim}), else of the first of `daily` that is due. Undefined
 * when nothing is. A window that throws leaves its work as it was, marked to
 * be tried again in an hour, and says why.
 */
export let work = (
  driver: Driver,
  now: number = Date.now(),
  daily: Daily[] = [],
  sizes: Sizes = SIZES,
  chores: Chore[] = [],
): Worked | undefined => {
  let due = owed(driver).find((w) => !w.next || Date.parse(w.next) <= now)
  if (!due) {
    return chore(driver, chores, now) ?? analysis(driver, now, sizes) ??
      reclaim(driver, now, sizes) ?? upkeep(driver, daily, now)
  }
  try {
    return unit(
      driver,
      () => ({ name: key(due), done: step(driver, due, sizes) }),
    )
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

let pragma = (driver: Driver, name: string) =>
  Number(Object.values(driver.query({ t: 'pragma', name })[0] ?? {})[0] ?? 0)

/** The `server_meta` key of {@link reclaim}: when it is next tried, after a
 * window that failed. */
export let RECLAIMING = 'reclaim'

/**
 * Give back the free pages past {@link SLACK}, at most {@link RECLAIM} a
 * window: SQLite moves pages from the end of the file into the free ones and
 * cuts the end off, which the next checkpoint writes to the file. Only a file
 * in incremental mode can (./db.ts `open`); one in another mode, or in
 * memory, has nothing to give. Undefined when nothing is past the slack; one
 * that throws is put off an hour.
 */
export let reclaim = (
  driver: Driver,
  now: number = Date.now(),
  sizes: Sizes = SIZES,
): Worked | undefined => {
  if (!driver.file || pragma(driver, 'auto_vacuum') != 2) return
  let past = pragma(driver, 'freelist_count') - sizes.slack
  if (past <= 0) return
  let m = meta(driver)
  let at = m.get(RECLAIMING)
  if (at && Date.parse(at) > now) return
  let n = Math.min(past, sizes.reclaim)
  try {
    unit(
      driver,
      () => driver.query({ t: 'pragma', name: 'incremental_vacuum', arg: n }),
    )
    return { name: RECLAIMING, done: n == past }
  } catch (error) {
    unit(driver, () => m.set(RECLAIMING, new Date(now + RETRY).toISOString()))
    return { name: RECLAIMING, error }
  }
}

// The first of `daily` that is due, done and put off a day; one that throws
// is put off an hour.
let upkeep = (
  driver: Driver,
  daily: Daily[],
  now: number,
): Worked | undefined => {
  let m = meta(driver)
  let due = daily.find((d) => {
    let at = m.get(DAILY + d.name)
    return !at || Date.parse(at) <= now
  })
  if (!due) return
  let name = DAILY + due.name
  let later = (ms: number) => m.set(name, new Date(now + ms).toISOString())
  try {
    unit(driver, () => {
      due.run(driver)
      later(DAY)
    })
    return { name, done: true }
  } catch (error) {
    unit(driver, () => later(RETRY))
    return { name, error }
  }
}

// The highest id among the next `n` rows of `source` past `cursor`, or null
// when there are none: where the window that takes them ends. A window's
// bounds are bound, never written into its text, so every window of one piece
// of work runs one prepared statement, where a text of its own would be
// compiled once and kept, pushing what a store repeats out of the driver's
// bounded cache.
let next = (driver: Driver, source: string, cursor: number, n: number) => {
  let [{ hi }] = driver.query(select({
    cols: [as(fn('max', col('entity')), 'hi')],
    from: from(
      select({
        cols: [col('entity')],
        from: table(source),
        where: gt(col('entity'), val(cursor)),
        order: [col('entity')],
        limit: val(n),
      }),
      'w',
    ),
  }))
  return hi == null ? null : Number(hi)
}

// The highest id among the next rows of a text index's source past `cursor`,
// at most `n` of them and as many as the text before each leaves under
// `text`, or null when there are none.
let reach = (
  driver: Driver,
  w: { source: string; props: string[]; cursor: number },
  n: number,
  text: number,
) => {
  let size = w.props.map((p) => fn('coalesce', fn('length', col(p)), lit(0)))
    .reduce((a, b) => op('+', a, b))
  let rows = select({
    cols: [col('entity'), as(size, 'size')],
    from: table(w.source),
    where: gt(col('entity'), val(w.cursor)),
    order: [col('entity')],
    limit: val(n),
  })
  let before = op(
    '-',
    over(fn('sum', col('size')), undefined, [col('entity')]),
    col('size'),
  )
  let [{ hi }] = driver.query(select({
    cols: [as(fn('max', col('entity')), 'hi')],
    from: from(
      select({
        cols: [col('entity'), as(before, 'before')],
        from: from(rows, 'w'),
      }),
      'r',
    ),
    where: lt(col('before'), val(text)),
  }))
  return hi == null ? null : Number(hi)
}

// The rows of `source` a window takes: past `cursor`, up to `hi`.
let window = (cursor: number, hi: number) =>
  and(gt(col('entity'), val(cursor)), le(col('entity'), val(hi)))

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
    sizes: Sizes,
  ) => boolean
} = {
  index: (driver, w, here) => {
    // A table a later vocabulary dropped takes its owed index with it.
    if (here.has(w.stmt.on)) driver.query({ ...w.stmt, ifNot: true })
    return true
  },
  fill: (driver, w, here, { fill, fillText }) => {
    // An index a later pass rebuilt whole, or dropped, is no longer this
    // work's.
    let guarded = here.get(w.triggers[0]?.name)?.sql?.includes(key(w))
    if (!here.has(w.name) || !guarded) return true
    let hi = reach(driver, w, fill, fillText)
    // Filled: the triggers keeping it behind the cursor give way to the ones
    // it keeps for good, each under the name it just gave up.
    if (hi == null) {
      for (let t of w.triggers) {
        driver.query({
          t: 'drop',
          kind: 'trigger',
          name: t.name,
          ifExists: true,
        })
        driver.query(t)
      }
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
  refit: (driver, w, here, sizes) => {
    let comp = w.name, into = w.table.name, old = leaving(comp)
    if (!here.has(comp) || !here.has(into)) return quit(driver, w), true
    let hi = next(driver, comp, w.cursor, sizes.copy)
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
    build(driver, w.after, sizes)
    owe(driver, { kind: 'clear', name: old })
    return true
  },
  clear: (driver, w, here, { clear }) => {
    if (!here.has(w.name)) return true
    let hi = next(driver, w.name, Number.MIN_SAFE_INTEGER, clear)
    if (hi == null) {
      driver.query({ t: 'drop', kind: 'table', name: w.name })
      return true
    }
    driver.query({
      t: 'delete',
      from: w.name,
      where: le(col('entity'), val(hi)),
    })
    return false
  },
}

// One window of `w`, inside its unit; true when the work is finished, and its
// row then gone. An index or a rebuilt table in place makes the statistics
// due, since the planner has none for it yet.
let step = (driver: Driver, w: Owed, sizes: Sizes): boolean => {
  let here = new Map(catalogue(driver).map((o) => [o.name, o]))
  let done = (windows[w.kind] as (
    d: Driver,
    w: Owed,
    h: Map<string, SchemaObject>,
    s: Sizes,
  ) => boolean)(driver, w, here, sizes)
  if (done) meta(driver).del(key(w))
  if (done && (w.kind == 'index' || w.kind == 'refit')) {
    meta(driver).del(DAILY + statistics.name)
  }
  return done
}

/**
 * The {@link Filler} @yaks/fts `adopt` hands a new or changed text index to:
 * on a file, an index whose content holds more than one window's rows is owed
 * and filled {@link FILL} rows at a time; a smaller one is rebuilt at once.
 */
export let filler = (driver: Driver, sizes: Sizes = SIZES): Filler => ({
  pending: (fts) =>
    owed(driver).some((w) => w.kind == 'fill' && w.name == fts)
      ? cursorOf({ kind: 'fill', name: fts })
      : undefined,
  owe: ({ fts, ...fill }) => {
    let here = catalogue(driver).some((o) => o.name == META)
    if (!driver.file || !here || !holds(driver, fill.source, sizes.fill + 1)) {
      return
    }
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
  sizes: Sizes = SIZES,
): boolean => {
  let names = new Set(catalogue(driver).map((o) => o.name))
  if (!driver.file || !names.has(META) || !holds(driver, comp, sizes.big)) {
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
 * Work off what this file owes, and do its upkeep, until `signal` aborts: a
 * window, a pause as long as the window held the lock so other writers get
 * their turn, and a look every `idle` milliseconds while nothing is due.
 * `daily` is the host's upkeep beside the statistics, and `chores` the work
 * its rows owe. A failed window is `report`ed and waits its hour.
 */
export let tend = async (
  driver: Driver,
  opts: {
    signal: AbortSignal
    report?: (error: unknown, work: string) => void
    idle?: number
    daily?: Daily[]
    chores?: Chore[]
  },
): Promise<void> => {
  let idle = opts.idle ?? 60_000
  let daily = [statistics, ...opts.daily ?? []]
  while (!opts.signal.aborted) {
    let at = performance.now()
    let did = work(driver, Date.now(), daily, SIZES, opts.chores)
    if (did && 'error' in did) opts.report?.(did.error, did.name)
    let held = performance.now() - at
    await sleep(did ? Math.max(10, held) : idle, opts.signal)
  }
}
