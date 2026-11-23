// The router: which of several offerings a default runs on. Pure, and its
// own module (`@yaks/model/route`) so what reads a default loads nothing else.
// The offerings are graph data, `routes` edges to `serves` edges, and so are
// the readings (`rate_limit`); the one who asks reads both and hands them
// here. Each rule orders the offerings it can speak for, best first, and the
// first rule that speaks for any answers. There are two: a pinned offering,
// then the plan with the most usage left. Which of a provider's accounts an
// offering runs on is chosen here too ({@link freest}).

import type { Eid } from '@yaks/graph'

/** One offering a default may run on. */
export type Route = {
  provider: Eid
  model: Eid
  /** what the model is called, for the reason */
  name: string
  /** the provider whose plan limits meter it (`provider.plan`, else its own) */
  plan: Eid
  /** when it was pinned (`routes.pinned`): a pinned offering is the answer,
   * whatever the plans read */
  pinned?: string
}

/** A plan limit's latest reading, as its `rate_limit` row holds it. */
export type Reading = {
  provider: Eid
  /** the account whose plan it is, where the reading came from one */
  account?: Eid
  /** minutes: 10080 a week, 300 five hours */
  window: number
  /** the model whose requests it meters, where it is a limit on one model */
  model?: Eid
  /** percent used */
  used: number
  resets?: string
  at?: string
}

/** What a router is asked: the offerings, what is known of their plans, and
 * the moment. A later rule's parameter (the work's kind) is another property
 * here. */
export type Asked = { routes: Route[]; readings: Reading[]; now: number }

/** The offering chosen and, in one line, why. */
export type Routed = { provider: Eid; model: Eid; why: string }

// An offering and what a rule learned of it, as the reason says it.
type Weighed = Route & { note?: string }
type Rule = (routes: Weighed[], asked: Asked) => Weighed[]

let span = (window: number) =>
  window == 10080 ? 'week' : window == 300 ? 'five hours' : `${window} min`

// A plan's reading, and its limit's on `model` where it has one: each one's
// longest window's, the newest where accounts differ.
let reading = (
  plan: Eid,
  readings: Reading[],
  model?: Eid,
): Reading | undefined =>
  readings.filter((r) => r.provider == plan && r.window > 0 && r.model == model)
    .sort((a, b) =>
      b.window - a.window || (b.at ?? '').localeCompare(a.at ?? '')
    )[0]

// The offerings whose plan has a reading, the most usage left first: what is
// left of the plan, or of its limit on the offering's model where that is
// less. A window that has reset since its reading is unused.
let roomiest: Rule = (routes, { readings, now }) =>
  routes.flatMap((route) => {
    let left = (r: Reading) =>
      r.resets && Date.parse(r.resets) <= now ? 100 : 100 - r.used
    let [r] = [
      reading(route.plan, readings),
      reading(route.plan, readings, route.model),
    ].filter((r) => r != null).sort((a, b) => left(a) - left(b))
    if (!r) return []
    let note = `has ${left(r)}% of its ${span(r.window)} left`
    return [{ left: left(r), route, note }]
  }).sort((a, b) => b.left - a.left)
    .map(({ route, note }) => ({ ...route, note }))

// The pinned offering, the newest pin where more than one is.
let pinned: Rule = (routes) =>
  routes.filter((r) => r.pinned)
    .sort((a, b) => b.pinned!.localeCompare(a.pinned!))
    .slice(0, 1).map((r) => ({ ...r, note: 'is pinned' }))

let rules: Rule[] = [pinned, roomiest]

/**
 * The offering to ask, or nothing where no rule can say: no routes, or none
 * pinned and no reading of any of their plans.
 *
 * ```ts
 * import { type Reading, route } from './route.ts'
 * import { equal } from '@yaks/testing'
 *
 * let routes = [
 *   { provider: 'claude', model: 'opus', name: 'opus', plan: 'claude' },
 *   { provider: 'openai', model: 'sol', name: 'sol', plan: 'codex' },
 * ]
 * let week = (provider: string, used: number, resets = '2026-11-17T00:00:00Z') =>
 *   ({ provider, window: 10080, used, resets })
 * let now = Date.parse('2026-11-11T00:00:00Z')
 * let ask = (readings: Reading[]) =>
 *   route({ routes, readings, now })
 *
 * equal(ask([week('claude', 84), week('codex', 82)]), {
 *   provider: 'openai',
 *   model: 'sol',
 *   why: 'sol has 18% of its week left, opus has 16% of its week left',
 * })
 * // A week that has reset since it was read is unused.
 * equal(ask([week('claude', 84, '2026-11-10T00:00:00Z'), week('codex', 82)])?.model, 'opus')
 * // A plan nothing has read can't win, and with no reading nothing is chosen.
 * equal(ask([week('claude', 99)])?.why, 'opus has 1% of its week left')
 * equal(ask([]), undefined)
 * // A limit on one model counts for that model where it leaves less.
 * equal(ask([week('claude', 40), { ...week('claude', 95), model: 'opus' }, week('codex', 82)])?.model, 'sol')
 * // A pinned offering wins over usage, and needs no reading.
 * let pin = { ...routes[0], pinned: '2026-11-11T00:00:00Z' }
 * equal(route({ routes: [pin, routes[1]], readings: [week('codex', 0)], now }), {
 *   provider: 'claude',
 *   model: 'opus',
 *   why: 'opus is pinned',
 * })
 * equal(route({ routes: [pin], readings: [], now })?.model, 'opus')
 * ```
 */
export let route = (asked: Asked): Routed | undefined => {
  let left = rules.map((rule) => rule(asked.routes, asked))
    .find((routes) => routes.length) ?? []
  return left.length
    ? {
      provider: left[0].provider,
      model: left[0].model,
      why: left.map((r) => `${r.name} ${r.note}`).join(', '),
    }
    : undefined
}

/**
 * Where a conversation goes on once the plan `from` runs on is spent: of the
 * offerings on another plan whose readings leave room, the one {@link route}
 * chooses, else the first of them. Nothing where every other plan is spent
 * too, or none is routed. The reason says which plan ran out.
 *
 * ```ts
 * import { onward } from './route.ts'
 * import { equal } from '@yaks/testing'
 *
 * let routes = [
 *   { provider: 'claude', model: 'opus', name: 'opus', plan: 'claude' },
 *   { provider: 'openai', model: 'sol', name: 'sol', plan: 'codex' },
 *   { provider: 'grok', model: 'grok-5', name: 'grok-5', plan: 'grok' },
 * ]
 * let now = Date.parse('2026-11-23T12:00:00Z')
 * let full = { provider: 'codex', window: 10080, used: 100, resets: '2026-11-25T00:00:00Z' }
 * let from = { provider: 'claude', model: 'opus' }
 * // With no readings, the next routed offering.
 * equal(onward({ routes, readings: [], now, from }), {
 *   provider: 'openai', model: 'sol', why: "opus's plan is spent; sol is next",
 * })
 * // A plan read full is passed over.
 * equal(onward({ routes, readings: [full], now, from })?.model, 'grok-5')
 * equal(onward({ routes: routes.slice(0, 2), readings: [full], now, from }), undefined)
 * ```
 */
export let onward = (
  asked: Asked & {
    from: { provider: Eid; model?: Eid }
    passed?: ReadonlySet<Eid>
    available?: ReadonlySet<Eid>
  },
): Routed | undefined => {
  let { routes, readings, now, from } = asked
  let was =
    routes.find((r) =>
      r.provider == from.provider && (!from.model || r.model == from.model)
    ) ?? routes.find((r) => r.provider == from.provider)
  let plan = was?.plan ?? from.provider
  let passed = new Set([plan, ...asked.passed ?? []])
  for (let r of routes) if (asked.passed?.has(r.provider)) passed.add(r.plan)
  let full = (plan: Eid) =>
    readings.some((r) =>
      r.provider == plan && r.used >= 100 &&
      !(r.resets && Date.parse(r.resets) <= now)
    )
  let open = routes.filter((r) =>
    (!asked.available || asked.available.has(r.provider)) &&
    !passed.has(r.plan) && !full(r.plan)
  )
  if (!open.length) return undefined
  let chosen = route({ ...asked, routes: open }) ??
    {
      provider: open[0].provider,
      model: open[0].model,
      why: `${open[0].name} is next`,
    }
  return {
    ...chosen,
    why: `${was ? `${was.name}'s plan` : 'its plan'} is spent; ${chosen.why}`,
  }
}

/** An account an offering may run on (`account`), and what it is called,
 * for the reason. */
export type Account = { account: Eid; name: string }

/** The account chosen and, in one line, why; `full` where its plan has no
 * room, as every account's had none. */
export type Freest = { account: Eid; why: string; full?: true }

const WEEK = 10080
const HOURS = 300

/** A window's usage against its pace, in points of the window. */
export type Pace = {
  /** the share of the window gone, rounded */
  gone: number
  /** the points used that its reset does not give back */
  spent: number
  /** `gone` less `spent`: below zero, over pace */
  under: number
}

/**
 * A window's usage against the share of it gone: `used` less the points
 * `back` a reset gives back (Fable's share of Claude's week), set against the
 * share of the window gone by `now`. A window that resets at an unknown time
 * is taken as all gone. The pace `claude-budget` prints (`bin/pace.ts`) and
 * the one {@link freest} picks an account by.
 *
 * ```ts
 * import { pace } from './route.ts'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-11-14T00:00:00Z') // three days into the week
 * let week = { window: 10080, used: 40, resets: '2026-11-18T00:00:00Z' }
 * equal(pace(week, now), { gone: 43, spent: 40, under: 3 })
 * equal(pace(week, now, 7), { gone: 43, spent: 33, under: 10 })
 * equal(pace({ ...week, used: 5 }, now, 7).spent, 0)
 * equal(pace({ window: 10080, used: 40 }, now).gone, 100)
 * ```
 */
export let pace = (
  window: { window: number; used: number; resets?: string },
  now: number,
  back = 0,
): Pace => {
  let ends = window.resets ? Date.parse(window.resets) : NaN
  let left = (ends - now) / (window.window * 60000)
  let gone = isNaN(left)
    ? 100
    : Math.round(100 * Math.min(1, Math.max(0, 1 - left)))
  let spent = Math.max(0, window.used - back)
  return { gone, spent, under: gone - spent }
}

// The points of the week a plan's limit on one model holds: Claude's cap on
// Fable is half the week, and a Fable reset gives its share back.
const CAP = 0.5

// Five hours are spent from this share on: an account whose five hours read
// this much used has no room for a run until they reset. The week is its
// pace's to weigh.
const FULL = 90

/**
 * The account further under its weekly pace ({@link pace}): the most points
 * between the share of its week gone and the share used, less what a reset of
 * its limit on one model gives back, half that limit's reading. A week that
 * has reset since its reading is unused, and an account nothing has read yet
 * goes first, so its first run reads it. An account whose five hours are
 * spent or nearly so goes after every account with room, and the answer says
 * `full` where none has any. Nothing where
 * there are no accounts.
 *
 * ```ts
 * import { freest } from './route.ts'
 * import { equal } from '@yaks/testing'
 *
 * let accounts = [{ account: 'a', name: '.claude' }, { account: 'b', name: '.claude-teams' }]
 * let now = Date.parse('2026-11-14T00:00:00Z') // three days into the week
 * let week = (account: string, used: number, resets = '2026-11-18T00:00:00Z') =>
 *   ({ provider: 'claude', account, window: 10080, used, resets })
 * equal(freest({ accounts, readings: [week('a', 20), week('b', 50)], now }), {
 *   account: 'a',
 *   why: '.claude is 23 points under its weekly pace, ' +
 *     '.claude-teams is 7 points over its weekly pace',
 * })
 * // Fable's share, half its cap's reading, is not held against the week.
 * let fable = { ...week('b', 80), model: 'fable' }
 * equal(freest({ accounts, readings: [week('a', 20), week('b', 50), fable], now })?.account, 'b')
 * equal(freest({ accounts, readings: [week('a', 20)], now })?.account, 'b')
 * equal(freest({ accounts, readings: [week('a', 20), week('b', 90, '2026-11-13T00:00:00Z')], now })?.account, 'b')
 * // Five hours used up put an account last, until they reset.
 * let hours = (account: string, used: number, resets = '2026-11-14T02:00:00Z') =>
 *   ({ provider: 'claude', account, window: 300, used, resets })
 * equal(freest({ accounts, readings: [week('a', 20), hours('a', 95), week('b', 50)], now }), {
 *   account: 'b',
 *   why: '.claude-teams is 7 points over its weekly pace, ' +
 *     '.claude has used 95% of its five hours',
 * })
 * equal(freest({ accounts, readings: [hours('a', 100, '2026-11-13T23:00:00Z')], now })?.account, 'a')
 * equal(freest({ accounts: accounts.slice(0, 1), readings: [hours('a', 100)], now })?.full, true)
 * equal(freest({ accounts: [], readings: [], now }), undefined)
 * ```
 */
export let freest = (
  asked: { accounts: Account[]; readings: Reading[]; now: number },
): Freest | undefined => {
  let { readings, now } = asked
  let current = (r: Reading) => !(r.resets && Date.parse(r.resets) <= now)
  // An account's newest reading of a window, of the plan or of its limit on
  // one model.
  let newest = (a: Account, window: number, capped = false) =>
    readings.filter((r) =>
      r.account == a.account && r.window == window && !r.model == !capped
    ).sort((x, y) => (y.at ?? '').localeCompare(x.at ?? ''))[0]
  // Its five hours' reading, where they are spent.
  let spent = (a: Account) => {
    let r = newest(a, HOURS)
    return r && current(r) && r.used >= FULL ? r : undefined
  }
  // Points under pace, and what the reason says where it is not a number.
  let weigh = (a: Account): { under: number; fresh?: string } => {
    let r = newest(a, WEEK)
    if (!r) return { under: Infinity, fresh: 'has no reading of its week' }
    if (!current(r)) return { under: Infinity, fresh: 'has a fresh week' }
    let cap = newest(a, WEEK, true)
    let running = cap && current(cap)
    return {
      under: Math.round(pace(r, now, running ? cap.used * CAP : 0).under),
    }
  }
  let weighed = asked.accounts.map((a) => ({
    ...a,
    ...weigh(a),
    spent: spent(a),
  }))
    .sort((x, y) => Number(!!x.spent) - Number(!!y.spent) || y.under - x.under)
  if (!weighed.length) return
  let said = (w: typeof weighed[0]) =>
    `${w.name} ${
      w.spent
        ? `has used ${w.spent.used}% of its ${span(w.spent.window)}`
        : w.fresh ??
          `is ${Math.abs(w.under)} points ${w.under < 0 ? 'over' : 'under'} ` +
            'its weekly pace'
    }`
  return {
    account: weighed[0].account,
    why: weighed.map(said).join(', '),
    ...weighed[0].spent ? { full: true as const } : {},
  }
}
