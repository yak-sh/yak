/**
 * How much of each topic's share of the week is used: pure, over the shares
 * (@yaks/topic/share), the sessions' lines and the day tallies. A session's
 * dollars are charged to the topic it was opened on, else to the one the
 * session that started it is charged to, and so on up; a topic with no share
 * passes them to the nearest topic above it that has one. On each plan they
 * are read over the plan's running week and turned into a part of that week
 * by the plan's rate ({@link rates}), beside how much of the week is gone.
 * Nothing here is stored: a share is the one number kept.
 *
 * @module
 */
import type { Eid } from '@yaks/graph'
import { above, holder, kept, type Shares } from '@yaks/topic/share'
import type { Spend } from './tally.ts'
import { billedOn, limitRates, paceOf, weekOf } from './window.ts'
import type { Limit } from './window.ts'
import { dollars, percent } from './words.ts'

/** What says where a session's spend is charged: the topic it was opened
 * on, and the session that started it. */
export type Line = { topic?: Eid; parent?: Eid }

/** What some work ran up against one weekly limit in its running week: a
 * plan's, or a plan's limit on one model. */
export type Billed = {
  plan: Eid
  /** the model the limit meters, where it is a limit on one model */
  model?: Eid
  /** what the limit is called */
  name: string
  /** usage at list price, not cash: the plan is a subscription */
  dollars: number
  /** those dollars as a part of the limit's week, 0 to 1, where the limit has
   * a reading of this week */
  used?: number
  /** how much of the limit's week is gone, 0 to 1 */
  gone: number
}

/** A topic's share against its use; with no `topic`, the work no share
 * covers against the part of the week no topic was given. */
export type Use = {
  topic?: Eid
  /** its share, 0 to 1 */
  share: number
  /** its share less the shares below it */
  keeps: number
  /** how many shares it sits under */
  depth: number
  plans: Billed[]
}

/**
 * The topic a session's spend is charged to: the share covering the topic it
 * was opened on, else the one its parent is charged to, up its line.
 *
 * ```ts
 * import { charged } from './use.ts'
 * import { equal } from '@yaks/testing'
 *
 * let shares = { share: new Map([['funnel', 0.1]]), up: new Map([['signup', ['funnel']]]) }
 * let to = charged(shares, new Map([
 *   ['head', { topic: 'funnel' }],
 *   ['oracle', { topic: 'signup' }],
 *   ['helper', { parent: 'worker' }],
 *   ['worker', { parent: 'head' }],
 *   ['other', {}],
 * ]))
 * equal(['head', 'oracle', 'helper', 'other'].map(to), ['funnel', 'funnel', 'funnel', undefined])
 * ```
 */
export let charged = (shares: Shares, lines: Map<Eid, Line>) =>
(
  session: Eid,
): Eid | undefined => {
  let seen = new Set<Eid>()
  for (
    let at: Eid | undefined = session;
    at && !seen.has(at);
    at = lines.get(at)?.parent
  ) {
    seen.add(at)
    let topic = lines.get(at)?.topic
    let to = topic && holder(shares, topic)
    if (to) return to
  }
}

/**
 * Each topic's share against what was used of it on each weekly limit, a
 * topic before the topics below it, then the work no share covers. A limit
 * on one model counts that model's requests alone, at its own rate. No
 * share, no rows.
 *
 * ```ts
 * import { uses } from './use.ts'
 * import { empty } from './tally.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'claude', of: 'c', name: 'claude', window: 10080, used: 30,
 *   resets: '2026-10-27T12:00:00Z', at: '2026-10-21T12:00:00Z' }
 * let sessions = { head: 100, helper: 50, other: 150 }
 * let day = { ...empty('2026-10-21'), plans: { c: { dollars: 300, parts: {}, sessions, tasks: {},
 *   models: { f: 50 }, metered: { f: { head: 10, other: 40 } }, entries: {} } } }
 * let asked = (limits: typeof week[]) => uses({
 *   shares: { share: new Map([['funnel', 0.25]]), up: new Map() },
 *   lines: new Map([['head', { topic: 'funnel' }], ['helper', { parent: 'head' }]]),
 *   limits,
 *   days: [day],
 *   now: Date.parse('2026-10-24T00:00:00Z'),
 * })
 * let plan = { plan: 'c', name: 'claude', gone: 0.5 }
 * equal(asked([week]), [
 *   { topic: 'funnel', share: 0.25, keeps: 0.25, depth: 0, plans: [{ ...plan, dollars: 150, used: 0.15 }] },
 *   { share: 0.75, keeps: 0.75, depth: 0, plans: [{ ...plan, dollars: 150, used: 0.15 }] },
 * ])
 * // The plan's limit on one model is a limit of its own: that model's dollars, at its rate.
 * let cap = { ...week, name: 'fable', model: 'f', used: 100 }
 * equal(asked([week, cap])[0].plans, [
 *   { ...plan, dollars: 150, used: 0.15 },
 *   { ...plan, name: 'fable', model: 'f', dollars: 10, used: 0.2 },
 * ])
 * ```
 */
export let uses = (o: {
  shares: Shares
  lines: Map<Eid, Line>
  limits: Limit[]
  days: Spend[]
  now: number
}): Use[] => {
  let { shares, limits, days, now } = o
  if (!shares.share.size) return []
  let to = charged(shares, o.lines)
  let rate = limitRates(limits, days, now)
  // Each limit's week, with its dollars by the topic they are charged to.
  let weeks = limits.flatMap((l) => {
    let from = weekOf(l, now)
    if (!from) return []
    let by = new Map<Eid | undefined, number>()
    for (let d of days) {
      if (d.day < from) continue
      for (let [session, n] of Object.entries(billedOn(l, d).sessions)) {
        by.set(to(session), (by.get(to(session)) ?? 0) + n)
      }
    }
    return [{ l, by }]
  })
  let billed = (topic?: Eid): Billed[] =>
    weeks.map(({ l, by }) => {
      let n = by.get(topic) ?? 0
      return {
        plan: l.of,
        ...l.model ? { model: l.model } : {},
        name: l.name,
        dollars: n,
        ...rate.has(l) ? { used: n * rate.get(l)! / 100 } : {},
        gone: paceOf(l, now),
      }
    })
  let keeps = kept(shares)
  let share = (t: Eid) => shares.share.get(t)!
  let seen = new Set<Eid>()
  let under = (up: Eid | undefined, depth: number): Use[] =>
    [...shares.share.keys()]
      .filter((t) => !seen.has(t) && above(shares, t) == up)
      .sort((a, b) => share(b) - share(a) || (a < b ? -1 : 1))
      .flatMap((t) => {
        seen.add(t)
        let row = {
          topic: t,
          share: share(t),
          keeps: keeps.get(t)!,
          depth,
          plans: billed(t),
        }
        return [row, ...under(t, depth + 1)]
      })
  let tree = under(undefined, 0)
  let free = 1 - tree.filter((u) => !u.depth).reduce((n, u) => n + u.share, 0)
  return [...tree, { share: free, keeps: free, depth: 0, plans: billed() }]
}

// A part of a week, as a percent to a tenth.
let part = (n: number) => `${Number((n * 100).toFixed(1))}%`

/**
 * A share against its use, as one line that stands alone: `name` is what the
 * topic is called. Every dollar figure says it is usage at list price.
 *
 * ```ts
 * import { said } from './use.ts'
 * import { equal } from '@yaks/testing'
 *
 * let plans = [
 *   { plan: 'c', name: 'claude', dollars: 34.1, used: 0.012, gone: 0.3 },
 *   { plan: 'x', name: 'codex', dollars: 2, gone: 0.55 },
 * ]
 * equal(said({ topic: 'q', share: 0.4, keeps: 0.25, depth: 0, plans }, 'Q-12 Pilots'),
 *   "Q-12 Pilots keeps 25% of each plan's week (its 40% less 15% given below): " +
 *   'claude 1.2% used ($34.10 of usage at list price), 30% of its week gone; ' +
 *   'codex has no reading of this week ($2.00 of usage at list price), 55% of its week gone')
 * equal(said({ share: 0.15, keeps: 0.15, depth: 0, plans: [] }),
 *   "Under no share (15% of each plan's week is not allotted): no plan's week has been read")
 * ```
 */
export let said = (u: Use, name = ''): string => {
  let head = !u.topic
    ? `Under no share (${part(u.share)} of each plan's week is not allotted)`
    : u.keeps == u.share
    ? `${name} has ${part(u.share)} of each plan's week`
    : `${name} keeps ${part(u.keeps)} of each plan's week (its ${
      part(u.share)
    } less ${part(u.share - u.keeps)} given below)`
  let plans = u.plans.map((p) =>
    `${p.name} ${
      p.used == null
        ? 'has no reading of this week'
        : `${percent(p.used * 100)} used`
    } (${dollars(p.dollars)} of usage at list price), ${
      Math.round(p.gone * 100)
    }% of its week gone`
  )
  return `${head}: ${plans.join('; ') || "no plan's week has been read"}`
}
