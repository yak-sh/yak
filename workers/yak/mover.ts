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
//   - each batch is one transaction of a few dozen rows, and the object
//     yields between batches, so requests interleave. An alarm moves a few
//     batches and comes back for the rest.
//   - every bound is counted in rows, never in time: inside a Worker the clock
//     stands still while code runs, and moves only when it waits. A store's
//     mover spends at most `SHARE` of its ceiling's windows, then comes back
//     once they end.
//   - a batch that fails unwinds and is reported, and the store keeps serving
//     the shape it holds. This incarnation leaves that rule alone; the next
//     one, which a fix arrives as, tries again.
//   - a batch its store's ceiling refuses (@yaks/durable-object `Stopped`)
//     unwinds too, and is no failure: the alarm moves on once the window
//     ends (graph.ts `#moveRows`). A move stands between batches, never in
//     one, so unlike a relocation (relocate.ts `freely`) it can stop there.
//   - how far a rule got is its {@link Stamp} in the store's memory, under the
//     rule's mark, written in the batch's own transaction.
//
// A {@link Rule} is data: the rows still in the old shape, as a query line, and
// the patch that moves one row. The patch is an ordinary kernel write, so every
// rule, effect and subscription the store has sees it, and a moved row is
// `updated` by the platform, when it moved.
//
// A rule is rehearsed before it runs ({@link rehearse}): every row it finds is
// moved inside a transaction that is rolled back, up to a bound, and the store
// says how many rows it found and moved, and what failed; the sweep times each
// store's answer from outside (`yak admin move --rehearse`). It runs for
// real only where `live` names: nowhere until every rehearsal is clean, then
// the app stores, then every store, the directory last. The release that
// makes a rule live adds its mark to migrate.ts `BOUNDARIES`, so a rollback
// never lands on code that cannot read what it moved.
import type { Bundle, Comp, Row } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { isPromise } from '@yaks/fp'
import { and, conjoin, parse, type Query } from '@yaks/query'
import { Unknown, type VocabDoc } from '@yaks/vocab'
import { GIT_STORE } from './door.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Mark, Rehearsal, Stamp } from '@yaks/platform/mover'
import { deadMailInboxRule } from './migrate.ts'
import { doneRun } from '../../packages/effects/cleanup.ts'
import { frozenMove, takeMove } from '@yaks/builders'
import { keyEid } from '@yaks/key'
import { commitRule } from './git-move.ts'
import { platformRule } from './platform-move.ts'
import { workerRule } from './worker-move.ts'
import { blobsRule } from './blobs-move.ts'
import { importedRule } from './imported-move.ts'
import { integrationOwnerRule } from './integration-move.ts'
import { holdEmptyRule } from './hold-move.ts'
import { phoneRule } from './phone-move.ts'
import { operatorNameRule } from './operator-name.ts'
import { sellerRule } from './seller-move.ts'
import { describedRule } from './described-move.ts'
import { proRule } from './pro-move.ts'
import { recipientRule } from './recipient-move.ts'
export type MoveContext = { store: string; app?: string; space?: string }

export type Rule = {
  mark: Mark
  /** Only these stores owe or rehearse this rule, or only the app stores;
   * absent means every store. */
  stores?: string[] | 'apps'
  /** These components must belong to the platform, never this app's declaration. */
  core?: string[]
  /** The rows still in the old shape, naming what `move` reads. */
  find: string | Query
  /** One candidate's patch. `read` looks up evidence synchronously without
   * adding reached rows to the candidate page or cursor. */
  move: (row: Bundle, read?: (line: string) => Bundle[]) => Bundle[]
  /** Retired declarations, visible only while reading/applying this move. */
  source?: VocabDoc
  /** Durable records delivered before the guarded source patches commit.
   * Rehearsal computes these records but never delivers them. */
  forward?: (
    row: Bundle,
    read?: (line: string) => Bundle[],
    context?: MoveContext,
  ) => Bundle[]
  /** Where it runs for real. Absent, it is only rehearsed. */
  live?: 'apps' | 'all'
  /** Source properties to shed with the final batch, once the rule is drained. */
  drop?: string[]
}

// This converter is rehearsed with an explicitly composed scratch vocabulary.
// Registration in hosted RULES must wait for the app/retained-vocabulary scan.
// This is only a rehearsal while old writers still set dispatch{state}.
// Keep that vocabulary and its authoritative reader until the writer cutover.
// The envelope stays on queued/active/waiting rows; settling gives it up.
export let dispatchMove = (row: Bundle): Bundle[] => {
  let dispatch = row.dispatch as Comp | undefined
  let state = dispatch?.state
  if (
    typeof state != 'string' ||
    !['queued', 'active', 'waiting', 'settled'].includes(state)
  ) {
    return []
  }
  let marks = ['admitted', 'waiting']
  let was = Object.fromEntries(marks.map((name) => {
    let mark = row[name] as Comp | undefined
    return [
      name,
      Object.fromEntries(
        ['at', 'by', 'via'].map((prop) => [prop, token(mark?.[prop])]),
      ),
    ]
  }))
  return [{
    entity: row.entity,
    dispatch: state == 'settled' ? null : { state: null },
    admitted: state == 'active' ? {} : null,
    waiting: state == 'waiting' ? {} : null,
    $was: {
      dispatch: {
        state: token(state),
        args: token(dispatch?.args),
        order: token(dispatch?.order),
      },
      ...was,
    },
  }]
}

export let dispatchRule: Rule & { find: string } = {
  mark: 'yak/store/dispatch/1',
  find: '.dispatch.state=queued,active,waiting,settled&*',
  move: dispatchMove,
}

/** Runs left `done` from before the pool deleted a run once it succeeded.
 * Each is deleted, or loses only `effect` where it carries more. */
export let doneEffectsRule: Rule = {
  mark: 'yak/store/done-effects/1',
  live: 'apps',
  find: '.effect.state=done&*',
  move: doneRun,
}

/** Fingerprints changed before retained takes were restored. Visit existing
 * builds and outputs once; the converter returns only the necessary patches.
 * Calls and output content are read as evidence and never rewritten. */
export let takeRule: Rule = {
  mark: 'yak/store/builder-takes/19',
  live: 'apps',
  find: '.build.call&*|.built.call&*',
  move: (row, read) => {
    if (!read) throw new Error('take conversion needs its build and call')
    let made = row.built as Comp | undefined
    if (!made) {
      let call = (row.build as Comp).call
      return frozenMove(
        row,
        call ? read(`.entity.eid=${call}&*`)[0] : undefined,
      )
    }
    let old = `${made.build}/${made.slot}`
    let value = `${old}/${made.call}`
    return takeMove(row, [
      ...read(
        `.entity.eid=${made.build},${made.call},${keyEid('output_of', old)},${
          keyEid('output_of', value)
        }&*`,
      ),
      ...read(`.built.build=${made.build}&.chosen&*`),
    ])
  },
}

/** Every rule a release carries. A rule leaves in the release after the sweep
 * reports every store done with it, with the old words it moved out of. */
export let RULES: Rule[] = [
  deadMailInboxRule,
  doneEffectsRule,
  takeRule,
  commitRule,
  platformRule,
  workerRule,
  blobsRule,
  importedRule,
  integrationOwnerRule,
  holdEmptyRule,
  operatorNameRule,
  phoneRule,
  sellerRule,
  describedRule,
  proRule,
  recipientRule,
]

/** The store as the mover reaches it, all of it synchronous: a batch is one
 * transaction, and a transaction cannot wait. `apply` holds its effects for
 * the caller, which runs them once the batch commits, or drops them. */
export type Moving = {
  context?: MoveContext
  read: (line: string | Query) => Bundle[] | Promise<Bundle[]>
  rows: (line: string | Query) => Row[] | Promise<Row[]>
  apply: (patch: Bundle[]) => Bundle[] | Promise<Bundle[]>
  tx: <T>(body: () => T) => T
  drop?: (paths: string[]) => void
  /** Whether the store's words declare this component, or its property. */
  speaks: (comp: string, prop?: string) => boolean
}

// The paths a line names, wherever they stand in it.
let paths = (node: unknown): string[][] =>
  Array.isArray(node)
    ? node.flatMap(paths)
    : node && typeof node == 'object'
    ? [
      ...Array.isArray((node as { path?: unknown }).path)
        ? [(node as { path: string[] }).path]
        : [],
      ...paths((node as { clauses?: unknown }).clauses),
      ...paths((node as { where?: unknown }).where),
    ]
    : []

/** Whether the store speaks every word a rule's line names: each component,
 * and the property named after it. A store lacking one holds nothing the rule
 * moves, so the rule is done there. A line whose words it speaks and that is
 * still refused was refused by our own code (a compiler a deploy changed), and
 * fails the batch, which reports it. */
export let spoken = (m: Moving, find: string | Query) =>
  paths(typeof find == 'string' ? parse(find) : find).every(([comp, prop]) =>
    m.speaks(comp, prop)
  )

/** Rows a batch takes. A store's one thread is held for the whole batch, and
 * one whose writes run many rules holds it longest: rehearsed, a batch of 200
 * held the Mossvale store for about a second, and 50 held the directory for
 * about a tenth of one. */
export let SIZE = 50

/** The batches an alarm moves before it comes back for the rest, how long it
 * waits to come back, and the batches a rehearsal holds the store for. */
export let BATCHES = 5
export let PAUSE = 1_000
export let REHEARSED = 20

/** The share of each of its store's windows (@yaks/durable-object `WINDOWS`)
 * a mover spends before it waits for the window to end, leaving the rest to
 * the store's requests. Bounded in batches alone it outran them: vale's 48,755
 * done runs, deleted 250 an alarm with every index row they held, wrote
 * 100,000 rows inside a minute. */
export let SHARE = 0.5

/** Whether a rule runs for real in this store. */
export let runs = (rule: Rule, store: string) =>
  rule.live == 'all' ||
  (rule.live == 'apps' && store != PLATFORM_STORE && store != GIT_STORE)

let sync = <T>(v: T | Promise<T>): T => {
  if (isPromise(v)) throw new Error('a store moves synchronously')
  return v as T
}

// The next page of a rule's rows, newest first, past the cursor.
let joined = (query: string | Query, line: string) =>
  typeof query == 'string'
    ? conjoin(query, line)
    : and(...query.clauses, ...parse(line).clauses)
let page = (rule: Rule, n: number, after?: string) =>
  joined(rule.find, conjoin(`.limit=${n}`, after ? `.after=${after}` : ''))

/** A bounded snapshot and its pure plan. A host can durably deliver `forward`
 * outside the transaction before committing the guarded source patches. */
export type Batch = {
  rows: Bundle[]
  patch: Bundle[]
  forward: Bundle[]
  unspoken?: string
}

export let batch = (
  m: Moving,
  rule: Rule,
  was: Stamp | null,
  n: number,
): Batch => {
  let rows: Bundle[]
  try {
    rows = sync(m.read(page(rule, n, was?.after)))
  } catch (e) {
    if (!(e instanceof Unknown) || spoken(m, rule.find)) throw e
    return { rows: [], patch: [], forward: [], unspoken: e.prop }
  }
  let read = (line: string) => sync(m.read(line))
  return {
    rows,
    patch: rows.flatMap((row) => rule.move(row, read)),
    forward: rows.flatMap((row) => rule.forward?.(row, read, m.context) ?? []),
  }
}

/** One batch commits the prepared snapshot. A page shorter than a batch is
 * the last one. Source guards refuse any changes made during delivery. */
export let step = (
  m: Moving,
  rule: Rule,
  was: Stamp | null,
  n: number,
  now: string,
  prepared: Batch = batch(m, rule, was, n),
): Stamp => {
  let { rows, patch, unspoken } = prepared
  if (unspoken) {
    return {
      ...was,
      moved: was?.moved ?? 0,
      ...rule.forward ? { forwarded: was?.forwarded ?? 0 } : {},
      at: now,
      done: now,
      unspoken,
    }
  }
  if (patch.length) sync(m.apply(patch))
  if (rows.length < n && rule.drop?.length) {
    if (!m.drop) {
      throw new Error('a store mover must support property contraction')
    }
    m.drop(rule.drop)
  }
  return {
    moved: (was?.moved ?? 0) + rows.length,
    ...rule.forward
      ? { forwarded: (was?.forwarded ?? 0) + prepared.forward.length }
      : {},
    at: now,
    after: rows.at(-1)?.entity.eid ?? was?.after,
    ...(rows.length < n ? { done: now } : {}),
  }
}

let said = (e: unknown) => e instanceof Error ? e.message : String(e)

/** Every rule moved inside a transaction that is rolled back, `bound` batches
 * at most: what it found, what it moved, and what failed. A rule is rehearsed
 * whether or not it is live, and whatever its stamp says. */
export let rehearse = (
  m: Moving,
  rules: Rule[],
  n: number,
  bound = REHEARSED,
): Rehearsal[] =>
  rules.map((rule) => {
    let r: Rehearsal = {
      mark: rule.mark,
      rows: 0,
      moved: 0,
      batches: 0,
      ...rule.forward ? { forwarded: 0 } : {},
    }
    let back = Symbol('rehearsal')
    try {
      let [counted] = sync(m.rows(joined(rule.find, '.count')))
      r.rows = Number(counted?.n ?? 0)
      m.tx(() => {
        let s: Stamp | null = null
        let now = new Date().toISOString()
        while (!s?.done && r.batches < bound) {
          s = step(m, rule, s, n, now)
          r.batches++
        }
        r.moved = s?.moved ?? 0
        if (rule.forward) r.forwarded = s?.forwarded ?? 0
        throw back
      })
    } catch (e) {
      if (e instanceof Unknown && !spoken(m, rule.find)) r.unspoken = e.prop
      else if (e !== back) r.failed = said(e)
    }
    return r
  })
