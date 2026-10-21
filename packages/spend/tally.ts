/**
 * A day's model requests, tallied: pure, over the rows a day's read returns
 * (./day.ts). Each request is its entry: `usage`, the `cost` its provider
 * reported or the hook weighed, and the `context_parts` the importer laid out
 * (@yaks/session/parts). The fixed part it carries is spread over the pieces
 * its session's `fixed` names; a request whose context was not recorded is one
 * part, `unrecorded`. Dollars are weighed per part at the model's price, then
 * scaled to what the provider reported where it did. Days add up (`merged`),
 * so a week is its days.
 *
 * @module
 */
import type { Bundle, Comp, Eid } from '@yaks/graph'
import type { Paid, Price, Usage } from '@yaks/model'
import { dollars, hourly } from '@yaks/model/vocab'

/** One day's tally, as `spend{…}` holds it. */
export type Spend = {
  day: string
  requests: number
  /** [read, write, fresh, generated] */
  tokens: number[]
  dollars: number
  /** by part: [read, write, fresh, generated, dollars] */
  parts: Record<string, number[]>
  /** by session: [tokens, dollars, requests] */
  sessions: Record<Eid, number[]>
  /** by task: [tokens, dollars] */
  tasks: Record<Eid, number[]>
  /** by model: [read, write, fresh, generated, dollars, requests] */
  models: Record<Eid, number[]>
  /** by entry: [tokens, dollars] */
  entries: Record<Eid, number[]>
  /** by the provider whose plan the requests billed against: what they ran
   * up on it */
  plans: Record<Eid, Plan>
}

/** The rows a tally ranks. */
export type Rows = 'parts' | 'sessions' | 'tasks' | 'models' | 'entries'

/** What one plan's requests ran up: their dollars, and each row's. */
export type Plan = { dollars: number } & Record<Rows, Record<string, number>>

let ROWS: Rows[] = ['parts', 'sessions', 'tasks', 'models', 'entries']

/** What a tally reads beside its requests. */
export type Known = {
  /** each model's price, by its eid */
  prices: Map<Eid, Price>
  /** each session's fixed part, piece by piece (@yaks/session `fixed`) */
  fixed: Map<Eid, Record<string, number>>
  /** the tasks each session worked on */
  tasks: Map<Eid, Eid[]>
  /** the provider whose plan each request billed against, where one did */
  plans?: Map<Eid, Eid>
}

/** How many entries a tally names. */
export let ENTRIES = 50

let comp = (b: Bundle, name: string) => (b[name] ?? {}) as Comp
let sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)

/** An empty day. */
export let empty = (day: string): Spend => ({
  day,
  requests: 0,
  tokens: [0, 0, 0, 0],
  dollars: 0,
  parts: {},
  sessions: {},
  tasks: {},
  models: {},
  entries: {},
  plans: {},
})

let unbilled = (): Plan => ({
  dollars: 0,
  parts: {},
  sessions: {},
  tasks: {},
  models: {},
  entries: {},
})

// Add `dollars` to what a plan's `row` holds under `key`.
let bill = (plan: Plan | undefined, row: Rows, key: string, n: number) => {
  if (plan) plan[row][key] = (plan[row][key] ?? 0) + n
}

// Add `more` into the tally `to` keeps under `key`.
let add = (to: Record<string, number[]>, key: string, more: number[]) => {
  let at = to[key] ??= more.map(() => 0)
  more.forEach((n, i) => at[i] += n)
}

// What a request used, as paid, where its context was not recorded.
let paid = (u: Usage): Paid => {
  let read = u.cached_tokens ?? 0
  let write = u.cache_write_tokens ?? 0
  return [
    read,
    write,
    Math.max(0, (u.input_tokens ?? 0) - read - write),
    u.output_tokens ?? 0,
  ]
}

// The fixed part spread over its pieces, by their sizes.
let spread = (p: Paid, pieces?: Record<string, number>): [string, Paid][] => {
  let total = sum(Object.values(pieces ?? {}))
  return total
    ? Object.entries(pieces!).map((
      [k, n],
    ) => [k, p.map((t) => t * n / total) as Paid])
    : [['fixed', p]]
}

// A request's parts, as paid.
let partsOf = (b: Bundle, known: Known): [string, Paid][] => {
  let cp = comp(b, 'context_parts')
  let parts = cp.parts as Record<string, Paid> | undefined
  if (!parts) return [['unrecorded', paid(comp(b, 'usage') as Usage)]]
  let session = String(comp(b, 'entry').session ?? '')
  return Object.entries(parts).flatMap(([k, p]): [string, Paid][] =>
    k == 'fixed' ? spread(p, known.fixed.get(session)) : [[k, p]]
  )
}

/**
 * One day's tally of its requests.
 *
 * ```ts
 * import { tally } from './tally.ts'
 * import { equal } from '@yaks/testing'
 *
 * let ask = {
 *   entity: { eid: 'a' },
 *   entry: { session: 's' },
 *   ask: { to: 'm' },
 *   usage: { input_tokens: 2e6, cached_tokens: 1e6, output_tokens: 0 },
 *   context_parts: { parts: { fixed: [1e6, 0, 0, 0], input: [0, 0, 1e6, 0] } },
 * }
 * let t = tally('2026-10-20', [ask], {
 *   prices: new Map([['m', { input: 4, cached: 0.2, output: 20 }]]),
 *   fixed: new Map([['s', { 'tool Read': 3, skills: 1 }]]),
 *   tasks: new Map([['s', ['T-1', 'T-2']]]),
 *   plans: new Map([['a', 'claude']]),
 * })
 * equal(t.dollars, 4.2)
 * equal([t.plans.claude.dollars, t.plans.claude.tasks], [4.2, { 'T-1': 2.1, 'T-2': 2.1 }])
 * equal(t.parts, {
 *   'tool Read': [750000, 0, 0, 0, 0.15],
 *   skills: [250000, 0, 0, 0, 0.05],
 *   input: [0, 0, 1000000, 0, 4],
 * })
 * equal(t.tasks, { 'T-1': [1e6, 2.1], 'T-2': [1e6, 2.1] })
 * ```
 */
export let tally = (day: string, rows: Bundle[], known: Known): Spend => {
  let out = empty(day)
  for (let b of rows) {
    let u = comp(b, 'usage') as Usage
    let model = String(comp(b, 'ask').to ?? comp(b, 'using').model ?? '')
    let price = known.prices.get(model)
    let hour = hourly(u)
    let weigh = (p: Paid) => price ? dollars(price, p, hour) : 0
    let parts = partsOf(b, known)
    let weighed = sum(parts.map(([, p]) => weigh(p)))
    let cost = comp(b, 'cost')
    let spent = cost.reported && typeof cost.dollars == 'number'
      ? cost.dollars
      : weighed
    // Dollars per part: weighed, scaled to what was reported; where nothing
    // weighs (no price), by tokens.
    let tokens = sum(parts.map(([, p]) => sum(p)))
    let share = (p: Paid) =>
      weighed
        ? weigh(p) * spent / weighed
        : tokens
        ? sum(p) * spent / tokens
        : 0
    let at = known.plans?.get(b.entity.eid)
    let plan = at ? out.plans[at] ??= unbilled() : undefined
    let all: Paid = [0, 0, 0, 0]
    for (let [k, p] of parts) {
      add(out.parts, k, [...p, share(p)])
      bill(plan, 'parts', k, share(p))
      p.forEach((n, i) => all[i] += n)
    }
    let entries = (comp(b, 'context_parts').entries ?? {}) as Record<Eid, Paid>
    for (let [eid, p] of Object.entries(entries)) {
      add(out.entries, eid, [sum(p), share(p)])
      bill(plan, 'entries', eid, share(p))
    }
    let session = String(comp(b, 'entry').session ?? '')
    let total = sum(all)
    add(out.sessions, session, [total, spent, 1])
    bill(plan, 'sessions', session, spent)
    let tasks = known.tasks.get(session) ?? []
    for (let t of tasks) {
      add(out.tasks, t, [total / tasks.length, spent / tasks.length])
      bill(plan, 'tasks', t, spent / tasks.length)
    }
    add(out.models, model, [...all, spent, 1])
    bill(plan, 'models', model, spent)
    if (plan) plan.dollars += spent
    out.tokens = out.tokens.map((n, i) => n + all[i])
    out.dollars += spent
    out.requests++
  }
  return settled(out)
}

/** A tally's numbers rounded as kept: tokens whole, dollars to the
 * hundredth of a cent, and its costliest entries alone. */
export let settled = (s: Spend): Spend => {
  let whole = (ns: number[], money: number[]) =>
    ns.map((n, i) =>
      money.includes(i) ? Math.round(n * 1e4) / 1e4 : Math.round(n)
    )
  let each = (m: Record<string, number[]>, money: number[]) =>
    Object.fromEntries(
      Object.entries(m).map(([k, ns]) => [k, whole(ns, money)]),
    )
  let entries = each(
    Object.fromEntries(ranked(s.entries, 1).slice(0, ENTRIES)),
    [1],
  )
  let cents = (n: number) => Math.round(n * 1e4) / 1e4
  let plan = (p: Plan): Plan => ({
    dollars: cents(p.dollars),
    ...Object.fromEntries(ROWS.map((row) => [
      row,
      Object.fromEntries(
        Object.entries(p[row])
          .filter(([k]) => row != 'entries' || k in entries)
          .map(([k, n]) => [k, cents(n)]),
      ),
    ])) as Record<Rows, Record<string, number>>,
  })
  return {
    ...s,
    tokens: whole(s.tokens, []),
    dollars: Math.round(s.dollars * 1e4) / 1e4,
    parts: each(s.parts, [4]),
    sessions: each(s.sessions, [1]),
    tasks: each(s.tasks, [1]),
    models: each(s.models, [4]),
    entries,
    plans: Object.fromEntries(
      Object.entries(s.plans ?? {}).map(([k, p]) => [k, plan(p)]),
    ),
  }
}

/**
 * Days added up, as one tally named by the first.
 *
 * ```ts
 * import { empty, merged } from './tally.ts'
 * import { equal } from '@yaks/testing'
 *
 * let a = { ...empty('2026-10-20'), requests: 2, dollars: 1, parts: { skills: [1, 0, 0, 0, 1] } }
 * let b = { ...empty('2026-10-21'), requests: 1, dollars: 2, parts: { skills: [2, 0, 0, 0, 2] } }
 * let m = merged([a, b])
 * equal([m.day, m.requests, m.dollars, m.parts], ['2026-10-20', 3, 3, { skills: [3, 0, 0, 0, 3] }])
 * ```
 */
export let merged = (days: Spend[]): Spend => {
  let out = empty(days[0]?.day ?? '')
  for (let d of days) {
    out.requests += d.requests
    out.dollars += d.dollars
    out.tokens = out.tokens.map((n, i) => n + (d.tokens[i] ?? 0))
    for (let k of ROWS) {
      for (let [key, ns] of Object.entries(d[k] ?? {})) add(out[k], key, ns)
    }
    for (let [at, p] of Object.entries(d.plans ?? {})) {
      let plan = out.plans[at] ??= unbilled()
      plan.dollars += p.dollars
      for (let row of ROWS) {
        for (let [k, n] of Object.entries(p[row] ?? {})) bill(plan, row, k, n)
      }
    }
  }
  return settled(out)
}

/** A tally's rows, costliest first, by the number at `at`. */
export let ranked = (
  m: Record<string, number[]>,
  at: number,
): [string, number[]][] =>
  Object.entries(m).sort((a, b) => (b[1][at] ?? 0) - (a[1][at] ?? 0))

/** The spend a row holds, as a tally. */
export let spendOf = (b: Bundle | undefined): Spend | undefined => {
  let s = b?.spend as Partial<Spend> | undefined
  return s?.day ? { ...empty(s.day), ...s } as Spend : undefined
}
