/**
 * Plan limits and the span of days a report covers: pure, for the page and
 * the report alike. A limit's pace is how much of its window is gone, which
 * is how much of it an even spend would have used by now.
 *
 * @module
 */
import type { Bundle, Eid } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import type { Plan, Spend } from './tally.ts'

/** A plan limit, as its `rate_limit` row reads, its provider named. */
export type Limit = {
  provider: string
  /** the plan's: its account's eid, else, for a reading that named no
   * account, its provider's */
  of: Eid
  /** the model whose requests it meters, where it is a limit on one model
   * and not on the whole plan */
  model?: Eid
  /** what the limit is called: its plan's name (its account's, else its
   * provider's); a limit on one model, the model's, after its account's
   * where the provider keeps several */
  name: string
  /** minutes: 10080 a week, 300 five hours */
  window: number
  /** percent used */
  used: number
  resets?: string
  at?: string
}

let WEEK = 7 * 864e5

let str = (v: unknown) => v == null ? '' : String(v)

/** The UTC day after `day`, and `n` days from it. */
export let after = (day: string, n = 1): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString()
    .slice(0, 10)

/** The UTC day a moment falls on. */
export let dayOf = (at: number | string): string =>
  new Date(at).toISOString().slice(0, 10)

/** The row a day's tally is kept on. */
export let dayEid = (day: string): Eid => identityEid('spend', [day])

/**
 * What each account is called, from its `account` row and its provider's
 * name: the provider's name where it keeps one account, else the account's
 * directory, `.claude-work`.
 *
 * ```ts
 * import { accountNames } from './window.ts'
 * import { equal } from '@yaks/testing'
 *
 * let a = (eid: string, home: string, provider: string) =>
 *   ({ entity: { eid }, account: { home, provider } })
 * let names = new Map([['c', 'claude'], ['x', 'codex']])
 * let rows = [a('1', '/u/.claude', 'c'), a('2', '/u/.claude-work', 'c'), a('3', '/u/.codex', 'x')]
 * equal([...accountNames(rows, names).values()], ['.claude', '.claude-work', 'codex'])
 * ```
 */
export let accountNames = (
  rows: Bundle[],
  providers: Map<Eid, string>,
): Map<Eid, string> => {
  let of = (b: Bundle) => str((b.account as { provider?: Eid }).provider)
  let count = new Map<Eid, number>()
  for (let b of rows) count.set(of(b), (count.get(of(b)) ?? 0) + 1)
  return new Map(
    rows.filter((b) => b.account).map((b) => {
      let home = str((b.account as { home?: string }).home)
      let name = count.get(of(b)) == 1
        ? providers.get(of(b))
        : home.slice(home.lastIndexOf('/') + 1)
      return [b.entity.eid, name || home]
    }),
  )
}

/**
 * The limits `rate_limit` rows hold, each plan's longest window first, by
 * `names`: the providers', the accounts' and the models'.
 *
 * ```ts
 * import { limitsOf } from './window.ts'
 * import { equal } from '@yaks/testing'
 *
 * let row = (more: object) =>
 *   ({ entity: { eid: 'r' }, rate_limit: { provider: 'p', account: 'a', window: 10080, ...more } })
 * let names = new Map([['p', 'claude'], ['a', 'claude'], ['m', 'fable']])
 * equal(limitsOf([row({ used: 6, model: 'm' }), row({ used: 43 })], names).map((l) => [l.name, l.used]),
 *   [['claude', 43], ['fable', 6]])
 * equal(limitsOf([row({ model: 'm' })], new Map([...names, ['a', '.claude-work']]))[0].name,
 *   '.claude-work fable')
 * ```
 */
export let limitsOf = (rows: Bundle[], names: Map<Eid, string>): Limit[] =>
  rows.flatMap((b): Limit[] => {
    let r = b.rate_limit as Record<string, unknown> | undefined
    if (!r) return []
    let provider = names.get(str(r.provider)) ?? str(r.provider)
    let of = str(r.account ?? r.provider)
    let plan = names.get(of) ?? provider
    let model = r.model ? str(r.model) : undefined
    let called = model && (names.get(model) ?? model)
    return [{
      provider,
      of,
      ...model ? { model } : {},
      name: !called ? plan : plan == provider ? called : `${plan} ${called}`,
      window: Number(r.window),
      used: Number(r.used ?? 0),
      ...r.resets ? { resets: str(r.resets) } : {},
      ...r.at ? { at: str(r.at) } : {},
    }]
  }).sort((a, b) =>
    a.name == b.name ? b.window - a.window : a.name < b.name ? -1 : 1
  )

// When a window that reset at `resets` resets next, from `now`.
let next = (resets: number, window: number, now: number) =>
  resets > now ? resets : resets + Math.ceil((now - resets) / window) * window

/**
 * How much of a limit's window is gone at `now`, 0 to 1: what an even spend
 * would have used by now.
 *
 * ```ts
 * import { paceOf } from './window.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'claude', of: 'c', name: 'claude', window: 10080, used: 25,
 *   resets: '2026-10-27T11:00:00Z' }
 * equal(paceOf(week, Date.parse('2026-10-23T23:00:00Z')), 0.5)
 * ```
 */
export let paceOf = (l: Limit, now: number): number => {
  if (!l.resets) return 0
  let window = l.window * 60_000
  let left = next(Date.parse(l.resets), window, now) - now
  return Math.min(1, Math.max(0, 1 - left / window))
}

/** Whether a reading is of the window now running: one taken before the
 * window last reset says nothing of this one. */
export let current = (l: Limit, now: number): boolean =>
  !l.resets || Date.parse(l.resets) > now

/**
 * The UTC day a plan's running week began, for a weekly limit that says when
 * it resets: a reading of a week gone by still says when this one began.
 *
 * ```ts
 * import { weekOf } from './window.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'claude', of: 'c', name: 'claude', window: 10080, used: 25,
 *   resets: '2026-10-27T11:00:00Z' }
 * equal(weekOf(week, Date.parse('2026-10-21T12:00:00Z')), '2026-10-20')
 * equal(weekOf(week, Date.parse('2026-10-29T12:00:00Z')), '2026-10-27')
 * equal(weekOf({ ...week, window: 300 }, Date.parse('2026-10-21T12:00:00Z')), undefined)
 * ```
 */
export let weekOf = (l: Limit, now: number): string | undefined =>
  l.window == 10080 && l.resets
    ? dayOf(next(Date.parse(l.resets), WEEK, now) - WEEK)
    : undefined

/**
 * The days a report covers: from `since`, else the UTC day the Claude plan's
 * week began, else six days before; to `until`, else today.
 *
 * ```ts
 * import { span } from './window.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'claude', of: 'c', name: 'claude', window: 10080, used: 25,
 *   resets: '2026-10-27T11:00:00Z' }
 * let now = Date.parse('2026-10-21T12:00:00Z')
 * equal(span([week], now), ['2026-10-20', '2026-10-21'])
 * equal(span([], now), ['2026-10-15', '2026-10-21'])
 * ```
 */
export let span = (
  limits: Limit[],
  now: number,
  since?: string,
  until?: string,
): [string, string] => {
  let to = until ?? dayOf(now)
  if (since) return [since, to]
  let week = limits.filter((l) => l.provider == 'claude')
    .flatMap((l) => weekOf(l, now) ?? [])[0]
  return [week ?? dayOf(Date.parse(`${to}T00:00:00Z`) - 6 * 864e5), to]
}

/** What a day's requests ran up on a limit, and each session's part of it:
 * its plan's, or its model's on that plan where it meters one model. */
export let billedOn = (
  l: Limit,
  d: Spend,
): { dollars: number; sessions: Record<Eid, number> } => {
  let plan: Plan | undefined = d.plans?.[l.of]
  return l.model
    ? {
      dollars: plan?.models[l.model] ?? 0,
      sessions: plan?.metered?.[l.model] ?? {},
    }
    : { dollars: plan?.dollars ?? 0, sessions: plan?.sessions ?? {} }
}

/**
 * What a dollar is worth in each weekly limit: the percent of the week its
 * latest reading says is used, over the dollars the requests it meters ran up
 * at list price from the day the week began to the day of the reading. An
 * estimate: the days are whole UTC days, and the dollars are what the tokens
 * would cost bought one by one. A limit with no reading of this week, or no
 * dollars in it, has none.
 *
 * ```ts
 * import { limitRates } from './window.ts'
 * import { empty } from './tally.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'claude', of: 'c', name: 'claude', window: 10080, used: 30,
 *   resets: '2026-10-27T11:00:00Z', at: '2026-10-21T12:00:00Z' }
 * let cap = { ...week, name: 'fable', model: 'f', used: 10 }
 * let day = { ...empty('2026-10-21'), plans: { c: { dollars: 300, parts: {}, sessions: {}, tasks: {},
 *   models: { f: 50, o: 250 }, entries: {} } } }
 * let rate = limitRates([week, cap], [day], Date.parse('2026-10-21T13:00:00Z'))
 * equal([rate.get(week), rate.get(cap)], [0.1, 0.2])
 * ```
 */
export let limitRates = (
  limits: Limit[],
  days: Spend[],
  now: number,
): Map<Limit, number> =>
  new Map(limits.flatMap((l): [Limit, number][] => {
    let dollars = weekDays(l, days, now)?.reduce(
      (n, d) => n + billedOn(l, d).dollars,
      0,
    )
    return dollars ? [[l, l.used / dollars]] : []
  }))

/**
 * What a dollar of each plan is worth in its weekly limit ({@link
 * limitRates}), by the plan's eid (its account's): the limit on the whole
 * plan, not one on a model.
 *
 * ```ts
 * import { rates } from './window.ts'
 * import { empty } from './tally.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'claude', of: 'c', name: 'claude', window: 10080, used: 30,
 *   resets: '2026-10-27T11:00:00Z', at: '2026-10-21T12:00:00Z' }
 * let day = (d: string, dollars: number) => ({ ...empty(d),
 *   plans: { c: { dollars, parts: {}, sessions: {}, tasks: {}, models: {}, entries: {} } } })
 * let days = [day('2026-10-19', 900), day('2026-10-20', 100), day('2026-10-21', 200)]
 * equal(rates([week], days, Date.parse('2026-10-21T13:00:00Z')).get('c'), 0.1)
 * ```
 */
export let rates = (
  limits: Limit[],
  days: Spend[],
  now: number,
): Map<Eid, number> =>
  new Map(
    [...limitRates(limits.filter((l) => !l.model), days, now)]
      .map(([l, rate]) => [l.of, rate]),
  )

// The days a plan's weekly reading counts, where it has a current one.
let weekDays = (l: Limit, days: Spend[], now: number): Spend[] | undefined => {
  let from = weekOf(l, now)
  if (!from || !current(l, now)) return
  let to = l.at ? l.at.slice(0, 10) : dayOf(now)
  return days.filter((d) => d.day >= from && d.day <= to)
}

/**
 * The models a plan's weekly rate was built without a price for, by the
 * plan's eid: their requests are in the week's dollars as nothing, so the
 * rate reads too low. A plan whose week holds none has no entry.
 *
 * ```ts
 * import { unpricedRates } from './window.ts'
 * import { empty } from './tally.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'codex', of: 'c', name: 'codex', window: 10080, used: 30,
 *   resets: '2026-10-27T11:00:00Z', at: '2026-10-21T12:00:00Z' }
 * let plan = { dollars: 1, unpriced: ['m'], parts: {}, sessions: {}, tasks: {}, models: {}, entries: {} }
 * let days = [{ ...empty('2026-10-20'), plans: { c: plan } }]
 * equal(unpricedRates([week], days, Date.parse('2026-10-21T13:00:00Z')).get('c'), ['m'])
 * ```
 */
export let unpricedRates = (
  limits: Limit[],
  days: Spend[],
  now: number,
): Map<Eid, Eid[]> =>
  new Map(
    limits.filter((l) => !l.model).flatMap((l): [Eid, Eid[]][] => {
      let models = [
        ...new Set(
          weekDays(l, days, now)?.flatMap((d) =>
            d.plans?.[l.of]?.unpriced ?? []
          ),
        ),
      ]
      return models.length ? [[l.of, models]] : []
    }),
  )
