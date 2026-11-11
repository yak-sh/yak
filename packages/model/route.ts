// The router: which of several offerings a default runs on. Pure, and its
// own module (`@yaks/model/route`) so what reads a default loads nothing else.
// The offerings are graph data, `routes` edges to `serves` edges, and so are
// the readings (`rate_limit`); the one who asks reads both and hands them
// here. Each rule orders the offerings it can speak for, best first, and the
// first rule that speaks for any answers. There are two: a pinned offering,
// then the plan with the most usage left.

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
  /** minutes: 10080 a week, 300 five hours */
  window: number
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

// A plan's reading: its longest window's, the newest where accounts differ.
let reading = (plan: Eid, readings: Reading[]): Reading | undefined =>
  readings.filter((r) => r.provider == plan && r.window > 0).sort((a, b) =>
    b.window - a.window || (b.at ?? '').localeCompare(a.at ?? '')
  )[0]

// The offerings whose plan has a reading, the most usage left first. A window
// that has reset since its reading is unused.
let roomiest: Rule = (routes, { readings, now }) =>
  routes.flatMap((route) => {
    let r = reading(route.plan, readings)
    if (!r) return []
    let left = r.resets && Date.parse(r.resets) <= now ? 100 : 100 - r.used
    return [{ left, route, note: `has ${left}% of its ${span(r.window)} left` }]
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
 * import { route } from './route.ts'
 * import { equal } from '@yaks/testing'
 *
 * let routes = [
 *   { provider: 'claude', model: 'opus', name: 'opus', plan: 'claude' },
 *   { provider: 'openai', model: 'sol', name: 'sol', plan: 'codex' },
 * ]
 * let week = (provider: string, used: number, resets = '2026-11-17T00:00:00Z') =>
 *   ({ provider, window: 10080, used, resets })
 * let now = Date.parse('2026-11-11T00:00:00Z')
 * let ask = (readings: ReturnType<typeof week>[]) =>
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
