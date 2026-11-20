// The downstream jobs. Intake never groups in its transaction; it only
// counts a flood's occurrences past what their bug keeps. No job writes a
// letter about one bug: agents hear of each bug from the open-bug watch
// (@yaks/heal), and a person from the daily digest (./digest.ts).

import type { Graph } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import { comp, type Desk, str } from './model.ts'
import { type Enrich, group, reframe, trim } from './group.ts'
import { enrichFrames } from './frames.ts'
import { occurring } from './reading.ts'
import { type Explanation, explanation, unexplained } from './resolution.ts'
import { tags } from './spread.ts'
import { send } from './digest.ts'

export type Options = {
  enrich?: Enrich
  /** The digest's recipient, by entity: the host resolves its address. */
  to?: string
  from?: string
  /** Global eid of this tracker store, which the digest's links scope. */
  store?: string
  /** Tracker web address for links in the digest. */
  url?: string
  /** Where the digest's chart is drawn: a `/chart.png` (./chart.ts). */
  chart?: string
  retain?: number
  /** Archive these occurrences in the tracker of `scope` (a space's) for
   * `reason`, as its owner's `fixed` would, and resolve with `said` a bug of
   * theirs left with none open: the platform's, which resolves bugs reported
   * from people's apps ({@link settle}). */
  settle?: (
    scope: string,
    eids: string[],
    reason: string,
    said?: Explanation,
  ) => Promise<unknown>
  /** Run again the work a resolved bug `bug` stopped for `owner` (a space,
   * whose Operator keeps it), named by the faults its occurrences tagged
   * `rerun` with the owner were reported under ({@link settle}). */
  rerun?: (
    owner: string,
    faults: string[],
    bug: string,
    said?: Explanation,
  ) => Promise<unknown>
}

/** A resolved bug closes the reports its occurrences stand for elsewhere: an
 * occurrence tagged with another tracker's `scope` and its `occurrence` there
 * (a break in a person's app, which yaks.app also records) is archived in
 * that tracker, so the app's owner and their Operator stop hearing of a break
 * yaks.app fixed; the reason is the resolution's cause. The resolution's
 * explanation goes with them, and resolves the space's bug they leave with no
 * open occurrence, so one fix never leaves a second copy open. An occurrence
 * tagged `rerun` stopped work its owner (a space) keeps under the
 * occurrence's fault, and each owner is handed the faults, so it runs that
 * work again now it can finish (the tracker keeps one such occurrence of each
 * owner, `retained`). Only occurrences from before the resolution are closed
 * or run again; a later one is the bug back, open in both. Archiving again
 * changes nothing, and an owner runs its work once for each bug, so a retry
 * is safe.
 *
 * ```ts
 * import { settle } from './effects.ts'
 * import { equal } from '@yaks/testing'
 * let at = (eid: string, t: string, tags = {}) =>
 *   ({ entity: { eid }, error: { at: t, bug: 'b', fault: 'f', tags } })
 * let rows = [
 *   { entity: { eid: 'b' }, bug: {}, resolved: { at: '2026-10-18T16:00Z', cause: 'a leak', recur: 'no' } },
 *   at('e1', '2026-10-18T15:49Z', { scope: 's', occurrence: 'o1' }),
 *   at('e2', '2026-10-18T15:50Z', { scope: 's', occurrence: 'o2' }),
 *   at('e3', '2026-10-18T15:51Z'),
 *   at('e4', '2026-10-19T09:00Z', { scope: 's', occurrence: 'o4' }),
 *   at('e5', '2026-10-18T15:52Z', { rerun: 'ada' }),
 *   at('e6', '2026-10-19T09:01Z', { rerun: 'bo' }),
 * ]
 * let g = {
 *   get: (eids: string[]) => Promise.resolve(rows.filter((r) => eids.includes(r.entity.eid))),
 *   read: () => Promise.resolve(rows.filter((r) => 'error' in r)),
 * }
 * let sent: unknown[][] = [], ran: unknown[][] = []
 * await settle(g as never, 'b', {
 *   settle: (...a) => Promise.resolve(sent.push(a)),
 *   rerun: (...a) => Promise.resolve(ran.push(a)),
 * })
 * let said = { cause: 'a leak', recur: 'no' }
 * equal(sent, [['s', ['o1', 'o2'], 'Fixed by yaks.app: a leak', said]])
 * equal(ran, [['ada', ['f'], 'b', said]])
 * ```
 */
export let settle = async (
  g: Desk,
  eid: string,
  options: Options,
): Promise<void> => {
  if (!options.settle && !options.rerun) return
  let [row] = await g.get([eid])
  if (!row?.bug || !row.resolved) return
  let resolved = comp(row, 'resolved')
  let until = str(resolved.at)
  let why = str(resolved.cause) || str(resolved.broke)
  let reason = why ? `Fixed by yaks.app: ${why}` : 'Fixed by yaks.app'
  // A resolution from before explanations were kept resolves nothing more.
  let said = unexplained(resolved).length
    ? undefined
    : explanation(resolved) as Explanation
  let by = new Map<string, string[]>(), runs = new Map<string, Set<string>>()
  for (let b of await g.read(occurring(eid))) {
    let error = comp(b, 'error')
    if (str(error.at) > until) continue
    let { scope, occurrence, rerun } = Object.fromEntries(tags(b))
    if (scope && occurrence) by.set(scope, [...by.get(scope) ?? [], occurrence])
    if (rerun && error.fault) {
      runs.set(rerun, (runs.get(rerun) ?? new Set()).add(str(error.fault)))
    }
  }
  if (options.settle) {
    for (let [scope, eids] of by) {
      await options.settle(scope, eids, reason, said)
    }
  }
  if (options.rerun) {
    for (let [owner, faults] of runs) {
      await options.rerun(owner, [...faults], eid, said)
    }
  }
}

export let effects = (
  host: { graph: Graph; config?: { port?: number } },
  options: Options = {},
): Handlers => {
  let enrich = options.enrich ?? enrichFrames()
  return {
    // Grouping trims the bug it grew, which reads one row until the bug
    // outgrows what it keeps: a run of its own per report cost more rows
    // than the report.
    error_group: async (e) => {
      let bug = await group(host.graph, e.entity.eid)
      if (bug) await trim(host.graph, bug, options.retain)
    },
    error_frames: async (e, _tx, _write, attempt) => {
      try {
        await reframe(host.graph, e.entity.eid, enrich)
      } catch (error) {
        if (
          attempt?.defer && error && typeof error == 'object' &&
          'retry' in error
        ) {
          await attempt.defer(5_000)
          return
        }
        throw error
      }
    },
    // The day's digest is the one due when its wake fired, so a retry
    // writes the same letter.
    bug_digest: async (e) => {
      let [row] = await host.graph.get([e.entity.eid], ['fired'])
      let at = Date.parse(str(comp(row, 'fired').at))
      if (Number.isFinite(at)) await send(host.graph, at, options)
    },
    bug_settle: (e) => settle(host.graph, e.entity.eid, options),
  }
}
