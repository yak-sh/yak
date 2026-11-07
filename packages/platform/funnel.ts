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

/** The home page's visits, clicks, sign-ups and checkouts under one campaign
 * or variant. */
export type FunnelSplit = {
  name: string
  home: number
  click: number
  signup: number
  checkout: number
}

/** Steps taken by somebody other than a person, by which: `bot`, `agent` or
 * `test`, a test account. */
export type FunnelApart = { client: string; step: string; n: number }

export type Funnel = {
  /** Where the window starts, as an ISO time; it runs to now. */
  since: string
  /** Each step people took, in the order a person meets them. */
  steps: FunnelCount[]
  apart: FunnelApart[]
  from: { site: string; n: number }[]
  buttons: { button: string; say: string; n: number }[]
  campaigns: FunnelSplit[]
  variants: FunnelSplit[]
}

let split = (s: FunnelSplit) =>
  `  ${s.name}: ${s.home} visits · ${s.click} clicks · ${s.signup} ` +
  `sign-ups · ${s.checkout} checkouts`

/**
 * The funnel in lines: each step people took and its share of the one it
 * follows, then the sites, calls to action, campaigns and variants, and last
 * what crawlers, agents and test accounts took, which no count above holds.
 *
 * @example
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let f = {
 *   since: '2026-11-07T00:00:00.000Z',
 *   steps: [
 *     { name: 'home', say: 'Home page visits', n: 40 },
 *     { name: 'click', say: 'Calls to action clicked', n: 10, share: 0.25, of: 'home' },
 *   ],
 *   apart: [{ client: 'test', step: 'signup', n: 2 }],
 *   from: [], buttons: [], campaigns: [], variants: [],
 * }
 * assertEquals(funnelLines(f), [
 *   'People since 2026-11-07T00:00:00.000Z:',
 *   '  Home page visits: 40',
 *   '  Calls to action clicked: 10 (25% of home)',
 *   'Not people, counted apart:',
 *   '  test signup: 2',
 * ])
 * ```
 */
export let funnelLines = (f: Funnel): string[] => {
  let group = <T>(say: string, rows: T[], line: (r: T) => string) =>
    rows.length ? [say, ...rows.map(line)] : []
  return [
    `People since ${f.since}:`,
    ...f.steps.map((s) =>
      `  ${s.say}: ${s.n}` +
      (s.share == null ? '' : ` (${Math.round(s.share * 100)}% of ${s.of})`)
    ),
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
