// What an object's SQL may cost before it says so, and stops. Cloudflare bills
// every row a statement reads or writes, whether or not it is returned, and
// offers no cap on it: its budget alerts "are informational only. They do not
// pause or cap usage", and they arrive a day late
// (https://developers.cloudflare.com/billing/manage/budget-alerts/). So the
// bound is kept where statements run. The driver (./sql.ts) counts each
// statement against the windows here, and two failures are told as they
// happen, never an hour later:
//
//   Scan     one statement read `SCAN` rows or more, and `FAR` times what it
//            represented in its answer or wrote.
//   Runaway  the object's statements together passed a window's rows.
//
// An object that `refuse`s takes no statement from then until the window
// ends: each is refused as `Stopped`, a 429 that says how long to wait, so a
// caller sends it again and a pool or a queue redelivers after the wait. Past
// its written rows it still reads; past its read rows it takes nothing. What a
// host must still write while stopped (keeping a person's write for later,
// or a pool's word on how a run ended) it runs in `free`, synchronously or
// across awaits, which counts against windows of its own: told past them,
// it stops nothing, so work that must not stop leaves no stop behind it. A
// host asks `stopped` at its doors, so a stopped object answers there rather
// than failing deep inside, and one whose stopping costs more than its rows
// (every door reads it) is `spare`d: told, never refused.
//
// The tallies outlive the instance that counted them, so an object evicted
// or restarted mid-window (a deploy restarts every object) goes on where it
// stood rather than spending another window's rows. Keeping them costs no row
// a statement: a window is kept, in one row of the object's own key-value
// storage (`ctx.storage.kv`), only as its rows pass half of what it may and as
// they pass all of it. That is at most two rows written a window for reads and
// two for writes, and none for an object that spends under half; a new
// instance reads that row once, at its first statement. An instance that ends
// unkept loses less than half a window.

import { AsyncLocalStorage } from 'node:async_hooks'
import { type Cost, finish, type Group, group, id, tally } from './profile.ts'

/** A span of time and the rows an object may read and write within it. */
export type Window = { ms: number; read: number; written: number }

/** What a window spent since it began, as an object keeps it past its
 * instance. */
export type Spent = {
  ms: number
  since: number
  read: number
  written: number
  /** What each lane's work spent of it ({@link Ceiling.lane}). */
  lanes?: Record<string, { read: number; written: number }>
}

/** A minute and an hour. At Cloudflare's prices ($0.001 a million rows read,
 * $1.00 a million written,
 * https://developers.cloudflare.com/durable-objects/platform/pricing/) an
 * object that refuses costs at most $0.20 of reads and $0.50 of writes in an
 * hour of its window, and one statement more. The week before these were set
 * (2026-11-03 to 11-10, Cloudflare's analytics) the platform's directory
 * peaked at 13.7 million rows read in a minute and 15.6 million in an hour,
 * and no object but the tracker in its storm wrote 100,000 in a minute. */
export let WINDOWS: Window[] = [
  { ms: 60_000, read: 50e6, written: 100_000 },
  { ms: 3_600_000, read: 200e6, written: 500_000 },
]

/** The rows one statement reads before it can be a scan. */
export let SCAN = 100_000
/** How many times what its answer represents or it wrote a scan reads. */
export let FAR = 100
// A statement costing fewer rows than this is counted and never named: its
// shape is not rendered for the tally.
let NAMED = 1_000
let HOUR = 3_600_000

type Kind = 'read' | 'written'
let KINDS: Kind[] = ['read', 'written']

// A window as it is counted: since when, what it spent and by which
// statements, what each lane spent of it, whether it is past its rows, and at
// which rows it is kept next.
type Span = Window & {
  since: number
  all: Group
  lanes: Map<string, Record<Kind, number>>
  past: Record<Kind, boolean>
  mark: Record<Kind, number>
}

/** One statement read far more rows than its answer represents. */
export class Scan extends Error {
  override name = 'Scan'
}

/** An object's statements passed a window's rows. */
export class Runaway extends Error {
  override name = 'Runaway'
}

/** A statement refused because its object is past a window: the caller's to
 * send again once `retry.after` milliseconds have run, and no defect of its
 * own, since the `Runaway` that stopped the object was told when it happened.
 * `retry.defer` says the wait is no failure: @yaks/effects runs the attempt
 * again as the same one, as it does a handler's `defer`. */
export class Stopped extends Error {
  override name = 'Stopped'
  status = 429
  retry: { after: number; defer: true }
  constructor(after: number, kind: Kind) {
    super(
      `this store ${kind == 'read' ? 'read' : 'wrote'} more rows than it ` +
        `may for now; try again in ${Math.ceil(after / 1000)} s`,
    )
    this.retry = { after, defer: true }
  }
}

/** Whether a failure is a statement an object refused as `Stopped`, met in
 * that object or through its stub. An RPC hands its caller a new error with
 * the name, message and own properties it was thrown with, never its class
 * (https://developers.cloudflare.com/workers/runtime-apis/rpc/error-handling/,
 * from compatibility date 2026-04-21), so it is known by those: its name and
 * the wait it asks for. Another package's error of the same name asks none.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { crossed } from './testing.ts'
 * let stop = new Stopped(42_000, 'written'), over = crossed(stop)
 * equal([stopped(stop), stopped(over), over instanceof Stopped], [true, true, false])
 * equal(over.message, stop.message)
 * equal(stopped(over) && over.retry, { after: 42_000, defer: true })
 * equal(stopped(Object.assign(Error('esbuild ended'), { name: 'Stopped' })), false)
 * ```
 */
export let stopped = (error: unknown): error is Stopped =>
  error instanceof Error && error.name == 'Stopped' &&
  typeof (error as { retry?: { after?: unknown } }).retry?.after == 'number'

/** What a report is filed under: `fault` groups its occurrences on one bug
 * (a scan by its statement, a runaway by which rows), and `tags` name the
 * statement. The host adds which object. */
export type Told = { fault: string; tags: Record<string, string> }
export type Report = (error: Scan | Runaway, told: Told) => void

export type Options = {
  windows?: Window[]
  now?: () => number
  /** Where a scan and a runaway go; each is also said on the console. */
  report?: Report
  /** Whether a statement past a window is refused, or only reported. */
  refuse?: boolean
  /** What an earlier instance of the object kept, asked at its first
   * statement. */
  kept?: () => Spent[] | undefined
  /** Keep what the windows spent past this instance: asked as a window's
   * rows pass half of what it may, and as they pass it. */
  keep?: (spent: Spent[]) => void
}

/** One statement as the driver counts it. `shape` is asked only of a
 * statement costly enough to name. */
export type Counted = {
  shape: () => string
  rowsRead: number
  rowsWritten: number
  returned: number
  /** Selected input rows represented by aggregate answers, when known. */
  matched?: number
}

export type Ceiling = {
  /** Refuse a statement while its object is stopped. */
  admit: (writing: boolean) => void
  count: (statement: Counted) => void
  /** What a statement would be refused with now, if anything. */
  refusal: (writing?: boolean) => Stopped | null
  /** How long until a statement is admitted, in ms: 0 when one is now. */
  stopped: (writing?: boolean) => number
  /** How long until the object has spent under `share` of every window's
   * rows, read and written, in ms: 0 when it has now. Work that can wait (a
   * store's mover) asks it before it spends more, and leaves the rest of each
   * window to the object's requests. `written` reserves a prospective unit;
   * Infinity means it cannot fit even in an empty window at that share. With
   * a `lane`, the share is of what that lane's own work spent ({@link lane}),
   * so one lane's backlog never spends another's allowance. */
  under: (share: number, written?: number, lane?: string) => number
  /** Run `body` as a lane's work: its statements, across the awaits of an
   * asynchronous body until it settles, count toward the lane's spend as
   * well as the object's. */
  lane: <T>(name: string, body: () => T) => T
  /** Run statements a stopped object must still take: `body`'s own, and
   * those of the work it awaits until it settles. What they cost is told,
   * and stops nothing. */
  free: <T>(body: () => T) => T
  /** Refuse nothing from now on, and go on telling: for an object whose
   * stopping costs more than its rows. */
  spare: () => void
  /** Current window counters, including those kept by an earlier instance. */
  spent: () => Spent[]
  /** Start fresh windows after an operator repairs a runaway; return the old counters. */
  resume: () => Spent[]
}

// An amount of rows as a person reads it: 264.5M, 480,000.
let rows = (n: number) =>
  n >= 1e6
    ? `${+(n / 1e6).toFixed(1)}M`
    : String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ',')

// Rows of a kind a tally spent.
let amount = (c: Cost, k: Kind) => k == 'read' ? c.rowsRead : c.rowsWritten

// What the statements a runaway cannot name spent of its kind: those under
// `NAMED` rows, and those past the shapes it keeps. Many small ones (a
// mover's deletes, each a few rows with its indexes) can pass a window with no
// named statement that spent any.
let unnamed = (g: Group, k: Kind) => {
  let named = [...g.shapes.values()].reduce((n, e) => n + amount(e, k), 0)
  return `${rows(amount(g.total, k) - named)} rows ${k} by statements too ` +
    `small or too many to name`
}

let span = (ms: number) => ms >= HOUR ? `${ms / HOUR} h` : `${ms / 60_000} min`

/** An object's ceiling: its windows, and what it has told.
 *
 * ```ts
 * import { ceiling, Stopped } from './ceiling.ts'
 * import { equal, throws } from '@yaks/testing'
 *
 * let at = 0, said: string[] = []
 * let c = ceiling({
 *   windows: [{ ms: 60_000, read: 1_000_000, written: 100 }],
 *   now: () => at,
 *   report: (e, told) => said.push(`${e.name} ${told.fault}`),
 *   refuse: true,
 * })
 * let ran = (rowsRead: number, returned = 0, rowsWritten = 0) =>
 *   c.count({ shape: () => 'select "t"', rowsRead, rowsWritten, returned })
 * ran(200_000, 3)
 * equal(said.map((s) => s.split('|')[0]), ['Scan scan'])
 * c.admit(false)
 * ran(900_000, 900_000)
 * equal(said.at(-1), 'Runaway runaway|read')
 * equal((await throws(() => c.admit(false))) instanceof Stopped, true)
 * equal(c.free(() => (c.admit(true), 'kept')), 'kept')
 * equal(c.stopped(), 60_000)
 * at = 60_000
 * c.admit(false)
 * ```
 */
export let ceiling = (
  { windows = WINDOWS, now = Date.now, report, refuse = false, kept, keep }:
    Options = {},
): Ceiling => {
  let spent = (s: Span, k: Kind) =>
    k == 'read' ? s.all.total.rowsRead : s.all.total.rowsWritten
  // Whether a span is past its rows of a kind, and the rows at which it is
  // kept next: half of what it may, then all of it.
  let marked = (s: Span, k: Kind) => {
    let n = spent(s, k)
    s.past[k] = n > s[k]
    s.mark[k] = s.past[k] ? Infinity : n > s[k] / 2 ? s[k] : s[k] / 2
  }
  let turned = (w: Window, since: number, was?: Spent): Span => {
    let s = {
      ...w,
      since,
      all: group(),
      lanes: new Map(),
      past: { read: false, written: false },
      mark: { read: 0, written: 0 },
    }
    if (was) {
      for (let to of [s.all.total, s.all.other]) {
        to.rowsRead = was.read
        to.rowsWritten = was.written
      }
      for (let [name, of] of Object.entries(was.lanes ?? {})) {
        s.lanes.set(name, { read: of.read, written: of.written })
      }
    }
    for (let k of KINDS) marked(s, k)
    return s
  }
  // What the object's own statements spent, which stops it, and what it ran
  // in `free`, which is told and stops nothing: a relocation's new object
  // writes its whole file before it serves, and serves from then on. The
  // first is taken up from where an earlier instance kept it.
  let spans: Span[] | undefined
  let begun = () => {
    let was = kept?.() ?? []
    return windows.map((w) => {
      let k = was.find((k) => k.ms == w.ms)
      return turned(w, k?.since ?? -Infinity, k)
    })
  }
  let live = () => spans ??= begun()
  let loose = windows.map((w) => turned(w, -Infinity))
  // When each scanning statement was last told, by its shape.
  let scans = new Map<string, number>()
  // The work running in `free`, and how many such are running: a statement
  // is free when it runs in one's async context while that work is open. A
  // timer or task the work leaves behind runs charged once it ends.
  let freeing = new AsyncLocalStorage<{ open: boolean }>()
  let open = 0
  let freed = () => open > 0 && freeing.getStore()?.open == true
  // The lane whose work is running, as `free` knows its own.
  let laning = new AsyncLocalStorage<{ name: string; open: boolean }>()
  // Runs `run` and closes `work` once it settles, across its awaits.
  let settled = <T>(
    work: { open: boolean },
    run: () => T,
    close = () => {},
  ): T => {
    let end = () => {
      work.open = false
      close()
    }
    let out
    try {
      out = run()
    } catch (e) {
      end()
      throw e
    }
    if (!(out instanceof Promise)) return end(), out
    return out.finally(end) as T
  }
  let broken = false
  let say = (error: Scan | Runaway, told: Told) => {
    console.error('storage', told.fault, error.message, JSON.stringify(told))
    try {
      report?.(error, told)
    } catch (e) {
      // A reporter that fails cannot change a store's answer.
      if (!broken) console.error('storage ceiling report failed', e)
      broken = true
    }
  }
  // How long a statement waits, and for which rows.
  let held = (writing: boolean) => {
    let at = now(), until = at, kind: Kind = 'read'
    for (let s of live()) {
      if (at - s.since >= s.ms) continue
      let end = s.since + s.ms
      if (s.past.read && end >= until) [until, kind] = [end, 'read']
      else if (writing && s.past.written && end > until) {
        ;[until, kind] = [end, 'written']
      }
    }
    return { wait: Math.max(0, until - at), kind }
  }
  let under = (share: number, written = 0, lane?: string) => {
    let at = now(), until = at
    for (let s of live()) {
      if (written > share * s.written) return Infinity
      if (at - s.since >= s.ms) continue
      let of = (k: Kind) =>
        lane == null ? spent(s, k) : s.lanes.get(lane)?.[k] ?? 0
      if (
        KINDS.some((k) =>
          k == 'written' && written
            ? of(k) + written > share * s[k]
            : of(k) >= share * s[k]
        )
      ) {
        until = Math.max(until, s.since + s.ms)
      }
    }
    return until - at
  }
  let count = (
    { shape, rowsRead, rowsWritten, returned, matched }: Counted,
  ) => {
    let at = now()
    let named = rowsRead + rowsWritten >= NAMED ? shape() : ''
    let cost: Cost = { calls: 1, rowsRead, rowsWritten }
    let tell: [Scan | Runaway, Told][] = []
    let charged = !freed(), list = charged ? live() : loose, moved = false
    let lane = charged ? laning.getStore() : undefined
    for (let i = 0; i < list.length; i++) {
      let s = list[i]
      if (at - s.since >= s.ms) s = list[i] = turned(s, at)
      if (lane?.open) {
        let of = s.lanes.get(lane.name) ?? { read: 0, written: 0 }
        of.read += rowsRead
        of.written += rowsWritten
        s.lanes.set(lane.name, of)
      }
      if (named) tally(s.all, { shape: named, rowsRead, rowsWritten }, 16)
      else {
        for (let to of [s.all.total, s.all.other]) {
          to.calls += cost.calls
          to.rowsRead += cost.rowsRead
          to.rowsWritten += cost.rowsWritten
        }
      }
      for (let k of KINDS) {
        let n = spent(s, k)
        if (n <= s.mark[k]) continue
        let was = s.past[k]
        marked(s, k)
        moved = true
        if (was || !s.past[k]) continue
        let top = finish(
          {
            ...s.all,
            other: { ...s.all.other },
            shapes: new Map(s.all.shapes),
          },
          k == 'read' ? 3 : 0,
          k == 'read' ? 0 : 3,
        ).statements.filter((e) => amount(e, k) > 0)
        tell.push([
          new Runaway(
            `${rows(n)} rows ${k} in ${span(s.ms)}, past the ${rows(s[k])} ` +
              `an object may` +
              (!charged
                ? ', in work it never stops'
                : refuse
                ? `: it takes no ${k == 'read' ? 'statement' : 'write'} for ` +
                  `${Math.ceil((s.since + s.ms - at) / 1000)} s`
                : ''),
          ),
          {
            fault: `runaway|${k}`,
            tags: {
              rows: String(n),
              window: span(s.ms),
              ...top[0] ? { statement: top[0].shape } : {},
              statements: JSON.stringify(top.map((e) => ({
                shape: e.shape.slice(0, 120),
                calls: e.calls,
                rowsRead: e.rowsRead,
                rowsWritten: e.rowsWritten,
              }))),
              ...amount(s.all.other, k) ? { unnamed: unnamed(s.all, k) } : {},
            },
          },
        ])
      }
    }
    if (
      rowsRead >= SCAN &&
      rowsRead >= FAR * Math.max(1, returned, matched ?? 0, rowsWritten)
    ) {
      let key = id(named)
      if (at - (scans.get(key) ?? -Infinity) >= HOUR) {
        if (scans.size >= 64) scans.clear()
        scans.set(key, at)
        tell.push([
          new Scan(
            `one statement read ${rows(rowsRead)} rows and returned ` +
              `${rows(returned)}: far more than its answer represents`,
          ),
          {
            fault: `scan|${key}`,
            tags: {
              statement: named.slice(0, 240),
              rows: String(rowsRead),
              returned: String(returned),
              ...matched != null ? { matched: String(matched) } : {},
              written: String(rowsWritten),
            },
          },
        ])
      }
    }
    if (charged && moved) {
      try {
        keep?.(snapshot())
      } catch (e) {
        // Keeping fails as reporting does: the windows still stand here.
        if (!broken) console.error('storage ceiling keep failed', e)
        broken = true
      }
    }
    // Told once the tallies stand: a reporter may run statements of its own.
    for (let [error, told] of tell) say(error, told)
  }
  let refusal = (writing = true) => {
    if (!refuse) return null
    let { wait, kind } = held(writing)
    return wait && !freed() ? new Stopped(wait, kind) : null
  }
  let snapshot = (): Spent[] =>
    live().map((s) => ({
      ms: s.ms,
      since: s.since,
      read: s.all.total.rowsRead,
      written: s.all.total.rowsWritten,
      ...s.lanes.size
        ? {
          lanes: Object.fromEntries(
            [...s.lanes].map(([name, of]) => [name, { ...of }]),
          ),
        }
        : {},
    }))
  return {
    admit: (writing) => {
      let no = refusal(writing)
      if (no) throw no
    },
    count,
    refusal,
    stopped: (writing) => refusal(writing)?.retry.after ?? 0,
    under,
    free: (body) => {
      let work = { open: true }
      open++
      return settled(work, () => freeing.run(work, body), () => open--)
    },
    lane: (name, body) => {
      let work = { name, open: true }
      return settled(work, () => laning.run(work, body))
    },
    spare: () => {
      refuse = false
    },
    spent: snapshot,
    resume: () => {
      let before = snapshot()
      spans = windows.map((w) => turned(w, now()))
      keep?.(snapshot())
      return before
    },
  }
}

// One ceiling an object: every driver over one storage is one connection
// (./sql.ts), so they count against the same windows.
let ceilings = new WeakMap<object, Ceiling>()

/** The synchronous key-value storage of a SQLite-backed object
 * (`ctx.storage.kv`), as far as a ceiling keeps its windows in it. */
export type Kv = {
  get(key: string): unknown
  put(key: string, value: unknown): void
}

// Where an object keeps what its windows spent.
let KEPT = 'ceiling:spent'

// A ceiling's windows kept in an object's own storage. A window is kept once
// the turn that passed its mark is over: a statement's transaction can unwind
// after it was counted (the `Stopped` it passed unwinds it), and the engine
// read and wrote its rows all the same.
let lasting = (kv: Kv | undefined): Pick<Options, 'kept' | 'keep'> => {
  if (!kv) return {}
  let due: Spent[] | undefined
  let put = () => {
    let spent = due
    due = undefined
    try {
      kv.put(KEPT, spent)
    } catch (e) {
      console.error('storage ceiling keep failed', e)
    }
  }
  return {
    kept: () => {
      try {
        let spent = kv.get(KEPT)
        return Array.isArray(spent) ? spent : undefined
      } catch (e) {
        console.error('storage ceiling kept unread', e)
      }
    },
    keep: (spent) => {
      if (!due) queueMicrotask(put)
      due = spent
    },
  }
}

/** The ceiling of the object whose storage this is. A host names its
 * reporter and whether it refuses once, as it is constructed, before its
 * first driver; a storage nobody spoke for is counted and reported on the
 * console.
 *
 * ```ts
 * // bounded(ctx.storage, { report, refuse: true })
 * // let sql = driver(ctx.storage) // counted against it
 * ```
 */
export let bounded = (durable: object, options?: Options): Ceiling => {
  let kv = (durable as { kv?: Kv }).kv
  let made = options
    ? ceiling({ ...lasting(kv), ...options })
    : ceilings.get(durable) ?? ceiling(lasting(kv))
  ceilings.set(durable, made)
  return made
}
