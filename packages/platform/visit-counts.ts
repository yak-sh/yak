/**
 * What a space's Visits page (./visits-view.ts) is drawn from beside the
 * space's apps (./side-rows.ts `sideApps`), as the tab's page graph holds it
 * (D-475 step 5): each app's page views from Cloudflare's analytics, which no
 * store holds. The page graph's door answers `visitCounts(space)` with a read
 * of them (yaks.app's views.ts `statsFor`), read again whenever the space's
 * apps move, as `visitCount{space, app, days, total, daily, pages, from,
 * countries}` an app, or one `visitCount{space, off}` where the platform
 * cannot say.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'

/** A day's views, or a name (a page, a site, a country) and its views. */
export type Day = { day: string; views: number }
export type Line = { name: string; views: number }

/** One app's views over the last `days`. */
export type Counted = {
  days: number
  total: number
  daily: Day[]
  pages: Line[]
  from: Line[]
  countries: Line[]
}

let COUNTS = '.visitCount.space='

/** The visits to the apps of the space `eid`. */
export let visitCounts = (eid: string): string => COUNTS + eid

/** The space a `visitCounts` line asks about, or undefined for another
 * line. */
export let countsSpace = (line: string): string | undefined =>
  line.startsWith(COUNTS) ? line.slice(COUNTS.length) : undefined

/** What the page says where the platform cannot count visits: no analytics
 * token is set, or Cloudflare's analytics did not answer. */
export let NOT_ON =
  'Visitor counts are not switched on for this platform yet, so there is ' +
  'nothing to show.'

let named = {
  type: 'array',
  items: {
    type: 'object',
    properties: { name: { type: 'string' }, views: { type: 'integer' } },
  },
}

export let visitWords: VocabDoc = {
  $defs: {
    visitCount: {
      component: true,
      type: 'object',
      properties: {
        space: { type: 'string' },
        app: { type: 'string' },
        days: { type: 'integer' },
        total: { type: 'integer' },
        daily: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day: { type: 'string' },
              views: { type: 'integer' },
            },
          },
        },
        pages: named,
        from: named,
        countries: named,
        off: { type: 'boolean' },
      },
      required: ['space'],
    },
  },
}

/** The views of each app of the space `space`, as rows: `counts` by app, or
 * null where the platform cannot say. */
export let countRows = (
  space: string,
  counts: Map<string, Counted> | null,
): Bundle[] =>
  counts
    ? [...counts].map(([app, c]) => ({
      entity: { eid: derivedEid(`visit-count|${space}|${app}`) },
      visitCount: {
        space,
        app,
        days: c.days,
        total: c.total,
        daily: c.daily,
        pages: c.pages,
        from: c.from,
        countries: c.countries,
      },
    }))
    : [{
      entity: { eid: derivedEid(`visits-off|${space}`) },
      visitCount: { space, off: true },
    }]

/** The views `rows` hold of each app of `space`, by app; null where they say
 * the platform cannot count them. */
export let countsOf = (
  rows: Bundle[],
  space: string,
): Map<string, Counted> | null => {
  let all = new Map<string, Counted>()
  for (let r of rows) {
    let c = r.visitCount as
      | (Counted & { space: string; app?: string; off?: boolean })
      | undefined
    if (c?.space != space) continue
    if (c.off) return null
    let { space: _, app, off: _off, ...counted } = c
    if (app) all.set(app, counted)
  }
  return all
}
