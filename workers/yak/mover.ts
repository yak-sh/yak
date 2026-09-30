// The store mover (D-45640 §Migration): a store's rows brought into a new
// shape after it has booted and while it serves, a batch at a time.
//
// A shape change used to run inside the boot transaction, where one failure
// refused the object and every read answered 503 until fixed code arrived. The
// mover never stands between a store and its requests:
//
//   - a Store moves from its alarm, once it has booted and serves (graph.ts
//     `#moving`). Nothing in boot waits on it, and a wake owed rows arms the
//     alarm rather than moving them itself.
//   - each batch is one transaction of a few hundred rows, and the object
//     yields between batches, so requests interleave. An alarm moves for a
//     slice of time and comes back for the rest.
//   - a batch that fails unwinds and is reported, and the store keeps serving
//     the shape it holds. This incarnation leaves that rule alone; the next
//     one, which a fix arrives as, tries again.
//   - how far a rule got is its {@link Stamp} in the store's memory, under the
//     rule's mark, written in the batch's own transaction.
//
// A {@link Rule} is data: the rows still in the old shape, as a query line, and
// the patch that moves one row. The patch is an ordinary kernel write, so every
// rule, effect and subscription the store has sees it, and a moved row is
// `updated` by the platform, when it moved.
//
// A rule is rehearsed before it runs ({@link rehearse}): every row it finds is
// moved inside a transaction that is rolled back, and the store says how many
// rows, how long, and what failed (`yak admin move --rehearse`). It runs for
// real only where `live` names: nowhere until every rehearsal is clean, then
// the app stores, then every store, the directory last. The release that
// makes a rule live adds its mark to migrate.ts `BOUNDARIES`, so a rollback
// never lands on code that cannot read what it moved.
import type { Bundle, Row } from '@yaks/graph'
import { isPromise } from '@yaks/fp'
import { conjoin } from '@yaks/query'
import { Unknown } from '@yaks/vocab'
import { GIT_STORE, PLATFORM_STORE } from './door.ts'

/** A rule's name: where its stamp is kept in a store's memory, and the
 * `BOUNDARIES` entry its live release adds. */
export type Mark = `yak/store/${string}`

export type Rule = {
  mark: Mark
  /** The rows still in the old shape, naming what `move` reads. */
  find: string
  /** One row's patch into the new shape. */
  move: (row: Bundle) => Bundle[]
  /** Where it runs for real. Absent, it is only rehearsed. */
  live?: 'apps' | 'all'
}

/** Every rule a release carries. A rule leaves in the release after the sweep
 * reports every store done with it, with the old words it moved out of. */
export let RULES: Rule[] = []

/** How far one rule got in one store. `after` is the last row it moved past;
 * `unspoken` is a word the rule reads that this store does not declare, so
 * it held nothing to move. */
export type Stamp = {
  moved: number
  at: string
  after?: string
  done?: string
  unspoken?: string
  failed?: string
}

/** Where one rule stands in one store, as a wake answers it. */
export type Standing = Partial<Stamp> & { mark: Mark; live: boolean }

/** What one rule's rehearsal found in one store: the rows it would move, how
 * many it moved before its time ran out, and the slowest batch, which is how
 * long the store's one thread is held at a time. */
export type Rehearsal = {
  mark: Mark
  rows: number
  moved: number
  batches: number
  ms: number
  slowest: number
  unspoken?: string
  failed?: string
}

/** The store as the mover reaches it, all of it synchronous: a batch is one
 * transaction, and a transaction cannot wait. `apply` holds its effects for
 * the caller, which runs them once the batch commits, or drops them. */
export type Moving = {
  read: (line: string) => Bundle[] | Promise<Bundle[]>
  rows: (line: string) => Row[] | Promise<Row[]>
  apply: (patch: Bundle[]) => Bundle[] | Promise<Bundle[]>
  tx: <T>(body: () => T) => T
}

/** Rows a batch takes: a few hundred in an app's store, fewer in the
 * directory, which every space's routing reads. */
export let size = (store: string) => store == PLATFORM_STORE ? 50 : 200

/** How long an alarm moves before it yields the object and comes back, and
 * how long a rehearsal may hold it. */
export let SLICE = 1_000
export let REHEARSAL = 2_000

/** Whether a rule runs for real in this store. */
export let runs = (rule: Rule, store: string) =>
  rule.live == 'all' ||
  (rule.live == 'apps' && store != PLATFORM_STORE && store != GIT_STORE)

let sync = <T>(v: T | Promise<T>): T => {
  if (isPromise(v)) throw new Error('a store moves synchronously')
  return v as T
}

// The next page of a rule's rows, newest first, past the cursor.
let page = (rule: Rule, n: number, after?: string) =>
  conjoin(rule.find, `.limit=${n}`, after ? `.after=${after}` : '')

/** One batch: the rows past the stamp's cursor, moved, and the stamp that
 * says so. A page shorter than a batch is the last one. */
export let step = (
  m: Moving,
  rule: Rule,
  was: Stamp | null,
  n: number,
  now: string,
): Stamp => {
  let rows: Bundle[]
  try {
    rows = sync(m.read(page(rule, n, was?.after)))
  } catch (e) {
    if (!(e instanceof Unknown)) throw e
    return { moved: 0, at: now, done: now, unspoken: e.prop }
  }
  if (rows.length) sync(m.apply(rows.flatMap(rule.move)))
  return {
    moved: (was?.moved ?? 0) + rows.length,
    at: now,
    after: rows.at(-1)?.entity.eid ?? was?.after,
    ...(rows.length < n ? { done: now } : {}),
  }
}

let said = (e: unknown) => e instanceof Error ? e.message : String(e)

/** Every rule moved inside a transaction that is rolled back: what it found,
 * what it moved in the time it had, and what failed. A rule is rehearsed
 * whether or not it is live, and whatever its stamp says. */
export let rehearse = (
  m: Moving,
  rules: Rule[],
  n: number,
  budget = REHEARSAL,
): Rehearsal[] =>
  rules.map((rule) => {
    let start = performance.now()
    let r: Rehearsal = {
      mark: rule.mark,
      rows: 0,
      moved: 0,
      batches: 0,
      ms: 0,
      slowest: 0,
    }
    let back = Symbol('rehearsal')
    try {
      let [counted] = sync(m.rows(conjoin(rule.find, '.count')))
      r.rows = Number(counted?.n ?? 0)
      m.tx(() => {
        let s: Stamp | null = null
        while (!s?.done && performance.now() - start < budget) {
          let t = performance.now()
          s = step(m, rule, s, n, new Date().toISOString())
          r.batches++
          r.slowest = Math.max(r.slowest, performance.now() - t)
        }
        r.moved = s?.moved ?? 0
        throw back
      })
    } catch (e) {
      if (e instanceof Unknown) r.unspoken = e.prop
      else if (e !== back) r.failed = said(e)
    }
    r.ms = performance.now() - start
    return r
  })
