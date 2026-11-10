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
//            returned or wrote: no index served its condition.
//   Runaway  the object's statements together passed a window's rows.
//
// An object that `refuse`s takes no statement from then until the window
// ends: each is refused as `Stopped`, a 429 that says how long to wait, so a
// caller sends it again and a pool or a queue redelivers after the wait. Past
// its written rows it still reads; past its read rows it takes nothing. What a
// host must still write while stopped (keeping a person's write for later) it
// runs in `free`. A host asks `stopped` at its doors, so a stopped object
// answers there rather than failing deep inside, and one whose stopping costs
// more than its rows (every door reads it) is `spare`d: told, never refused.
//
// The tallies live in the instance's memory. A storm keeps its object awake,
// so they hold through one; an object evicted between bursts starts its
// windows over.

import { type Cost, finish, group, id, tally } from './profile.ts'

/** A span of time and the rows an object may read and write within it. */
export type Window = { ms: number; read: number; written: number }

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
/** How many times what it returned or wrote a scan reads. */
export let FAR = 100
// A statement costing fewer rows than this is counted and never named: its
// shape is not rendered for the tally.
let NAMED = 1_000
let HOUR = 3_600_000

type Kind = 'read' | 'written'

/** One statement read far more rows than it returned. */
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
}

/** One statement as the driver counts it. `shape` is asked only of a
 * statement costly enough to name. */
export type Counted = {
  shape: () => string
  rowsRead: number
  rowsWritten: number
  returned: number
}

export type Ceiling = {
  /** Refuse a statement while its object is stopped. */
  admit: (writing: boolean) => void
  count: (statement: Counted) => void
  /** What a statement would be refused with now, if anything. */
  refusal: (writing?: boolean) => Stopped | null
  /** How long until a statement is admitted, in ms: 0 when one is now. */
  stopped: (writing?: boolean) => number
  /** Run statements a stopped object must still take. */
  free: <T>(body: () => T) => T
  /** Refuse nothing from now on, and go on telling: for an object whose
   * stopping costs more than its rows. */
  spare: () => void
}

// An amount of rows as a person reads it: 264.5M, 480,000.
let rows = (n: number) =>
  n >= 1e6
    ? `${+(n / 1e6).toFixed(1)}M`
    : String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ',')

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
  { windows = WINDOWS, now = Date.now, report, refuse = false }: Options = {},
): Ceiling => {
  let turned = (w: Window, since: number) => ({
    ...w,
    since,
    all: group(),
    past: { read: false, written: false },
  })
  let spans = windows.map((w) => turned(w, -Infinity))
  // When each scanning statement was last told, by its shape.
  let scans = new Map<string, number>()
  let freed = 0
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
    let at = now(), until = 0, kind: Kind = 'read'
    for (let s of spans) {
      if (at - s.since >= s.ms) continue
      let end = s.since + s.ms
      if (s.past.read && end >= until) [until, kind] = [end, 'read']
      else if (writing && s.past.written && end > until) {
        ;[until, kind] = [end, 'written']
      }
    }
    return { wait: Math.max(0, until - at), kind }
  }
  let count = ({ shape, rowsRead, rowsWritten, returned }: Counted) => {
    let at = now()
    let named = rowsRead + rowsWritten >= NAMED ? shape() : ''
    let cost: Cost = { calls: 1, rowsRead, rowsWritten }
    let tell: [Scan | Runaway, Told][] = []
    spans = spans.map((s) => at - s.since >= s.ms ? turned(s, at) : s)
    for (let s of spans) {
      if (named) tally(s.all, { shape: named, rowsRead, rowsWritten }, 16)
      else {
        for (let to of [s.all.total, s.all.other]) {
          to.calls += cost.calls
          to.rowsRead += cost.rowsRead
          to.rowsWritten += cost.rowsWritten
        }
      }
      for (let k of ['read', 'written'] as Kind[]) {
        let n = k == 'read' ? s.all.total.rowsRead : s.all.total.rowsWritten
        if (n <= s[k] || s.past[k]) continue
        s.past[k] = true
        let top = finish(
          {
            ...s.all,
            other: { ...s.all.other },
            shapes: new Map(s.all.shapes),
          },
          k == 'read' ? 3 : 0,
          k == 'read' ? 0 : 3,
        ).statements
        tell.push([
          new Runaway(
            `${rows(n)} rows ${k} in ${span(s.ms)}, past the ${rows(s[k])} ` +
              `an object may` +
              (refuse
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
            },
          },
        ])
      }
    }
    if (
      rowsRead >= SCAN && rowsRead >= FAR * Math.max(1, returned, rowsWritten)
    ) {
      let key = id(named)
      if (at - (scans.get(key) ?? -Infinity) >= HOUR) {
        if (scans.size >= 64) scans.clear()
        scans.set(key, at)
        tell.push([
          new Scan(
            `one statement read ${rows(rowsRead)} rows and returned ` +
              `${rows(returned)}: no index serves its condition`,
          ),
          {
            fault: `scan|${key}`,
            tags: {
              statement: named.slice(0, 240),
              rows: String(rowsRead),
              returned: String(returned),
              written: String(rowsWritten),
            },
          },
        ])
      }
    }
    // Told once the tallies stand: a reporter may run statements of its own.
    for (let [error, told] of tell) say(error, told)
  }
  let refusal = (writing = true) => {
    if (!refuse || freed) return null
    let { wait, kind } = held(writing)
    return wait ? new Stopped(wait, kind) : null
  }
  return {
    admit: (writing) => {
      let no = refusal(writing)
      if (no) throw no
    },
    count,
    refusal,
    stopped: (writing) => refusal(writing)?.retry.after ?? 0,
    free: (body) => {
      freed++
      try {
        return body()
      } finally {
        freed--
      }
    },
    spare: () => {
      refuse = false
    },
  }
}

// One ceiling an object: every driver over one storage is one connection
// (./sql.ts), so they count against the same windows.
let ceilings = new WeakMap<object, Ceiling>()

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
  let made = options ? ceiling(options) : ceilings.get(durable) ?? ceiling()
  ceilings.set(durable, made)
  return made
}
