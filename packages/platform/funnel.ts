// yaks.app's own funnel as the platform answers it (workers/yak funnel.ts)
// and as a person reads it, the same on the box's admin_funnel and wherever
// else it is shown in lines.

/** One step's count over the window, and its share of the step it is
 * measured against (`of`), where that step was taken. */
export type FunnelCount = {
  name: string
  say: string
  n: number
  share?: number
  of?: string
}

/** The home page's visits, clicks, builds begun in its box, sign-ups and
 * checkouts under one campaign or variant. A Worker older than the builds
 * begun has none. */
export type FunnelSplit = {
  name: string
  home: number
  click: number
  started?: number
  signup: number
  checkout: number
}

/** Steps taken by somebody other than a person, by which: `bot`, `agent` or
 * `test`, a test account. */
export type FunnelApart = { client: string; step: string; n: number }

export type Funnel = {
  /** Where the window starts, as an ISO time; it runs to now. */
  since: string
  /** How far strangers got: each stage of their way, from a visit to coming
   * back, and its share of the stage it follows (`of`), for one that follows
   * one. A Worker older than these has none. */
  stages?: FunnelCount[]
  /** Each step people took, in the order a person meets them. */
  steps: FunnelCount[]
  apart: FunnelApart[]
  from: { site: string; n: number }[]
  buttons: { button: string; say: string; n: number }[]
  campaigns: FunnelSplit[]
  variants: FunnelSplit[]
}

/** A stage most go no further than, and the share of it that went on. */
export type Stop = { after: FunnelCount; went: number }

/**
 * Where most stop: the stage a stage that follows it keeps the smallest share
 * of, and that share. None until a stage after one somebody reached is read.
 *
 * @example
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = (name: string, n: number, of?: string, share?: number) =>
 *   ({ name, say: name, n, of, share })
 * let way = [
 *   at('visit', 40),
 *   at('built', 4, 'visit', 0.1),
 *   at('connected', 3),
 *   at('signup', 6),
 *   at('first_app', 2, 'signup', 1 / 3),
 * ]
 * assertEquals(stopped(way), { after: way[0], went: 0.1 })
 * assertEquals(stopped([at('visit', 0)]), undefined)
 * ```
 */
export let stopped = (stages: FunnelCount[] = []): Stop | undefined =>
  stages.reduce<Stop | undefined>((low, s) => {
    let after = stages.find((a) => a.name == s.of)
    return !after || s.share == null || (low && low.went <= s.share)
      ? low
      : { after, went: s.share }
  }, undefined)

let pct = (share: number) => `${Math.round(share * 100)}%`

/** What one campaign or variant brought, in a line. */
export let splitSays = (s: FunnelSplit) =>
  `${s.home} visits · ${s.click} clicks · ${s.started ?? 0} builds begun · ` +
  `${s.signup} sign-ups · ${s.checkout} checkouts`

let split = (s: FunnelSplit) => `  ${s.name}: ${splitSays(s)}`

/**
 * The funnel in lines: how far strangers got, stage by stage, and where most
 * of them stop; each step people took and its share of the one it follows; then the sites, calls to action, campaigns and variants, and last
 * what crawlers, agents and test accounts took, which no count above holds.
 *
 * @example
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let f = {
 *   since: '2026-11-07T00:00:00.000Z',
 *   stages: [
 *     { name: 'visit', say: 'Home page visits', n: 40 },
 *     { name: 'built', say: "Builds begun in the home page's box", n: 4, share: 0.1, of: 'visit' },
 *     { name: 'connected', say: 'Connector sign-ins begun', n: 3 },
 *   ],
 *   steps: [
 *     { name: 'home', say: 'Home page visits', n: 40 },
 *     { name: 'click', say: 'Calls to action clicked', n: 10, share: 0.25, of: 'home' },
 *     { name: 'paid', say: 'Plans bought', n: 0 },
 *   ],
 *   apart: [{ client: 'test', step: 'signup', n: 2 }],
 *   from: [], buttons: [], campaigns: [], variants: [],
 * }
 * assertEquals(funnelLines(f), [
 *   'How far strangers got since 2026-11-07T00:00:00.000Z:',
 *   '  Home page visits: 40',
 *   "  Builds begun in the home page's box: 4 (10% of visit)",
 *   '  Connector sign-ins begun: 3',
 *   '  Most stop after home page visits: 10% went on',
 *   'People since 2026-11-07T00:00:00.000Z:',
 *   '  Home page visits: 40',
 *   '  Calls to action clicked: 10 (25% of home)',
 *   '  Plans bought: 0',
 *   'Not people, counted apart:',
 *   '  test signup: 2',
 * ])
 * ```
 */
export let funnelLines = (f: Funnel): string[] => {
  let group = <T>(say: string, rows: T[], line: (r: T) => string) =>
    rows.length ? [say, ...rows.map(line)] : []
  let count = (s: FunnelCount) =>
    `  ${s.say}: ${s.n}` +
    (s.share == null ? '' : ` (${pct(s.share)} of ${s.of})`)
  let stop = stopped(f.stages)
  return [
    ...group(`How far strangers got since ${f.since}:`, f.stages ?? [], count),
    ...stop
      ? [
        `  Most stop after ${stop.after.say.toLowerCase()}: ${
          pct(stop.went)
        } went on`,
      ]
      : [],
    `People since ${f.since}:`,
    ...f.steps.map(count),
    ...group(
      'Came to the home page from:',
      f.from,
      (r) => `  ${r.site}: ${r.n}`,
    ),
    ...group(
      'Calls to action clicked:',
      f.buttons,
      (r) => `  ${r.button} (${r.say}): ${r.n}`,
    ),
    ...group('By campaign:', f.campaigns, split),
    ...group('By home page variant:', f.variants, split),
    ...group(
      'Not people, counted apart:',
      f.apart,
      (r) => `  ${r.client} ${r.step}: ${r.n}`,
    ),
  ]
}
