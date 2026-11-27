/**
 * What a space's Visits page (./visits-view.ts) is drawn from beside the
 * space's apps (./side-rows.ts `sideApps`), as the tab's page graph holds it
 * (D-475 step 5): each app's page views from Cloudflare's analytics, which no
 * store holds. The page graph's door answers `visitCounts(space)` with a read
 * of them (yaks.app's views.ts `statsFor`), read again whenever the space's
 * apps move, as `visitCount{space, app, bots, days, total, split, daily,
 * pages, from, countries}` an app, or one `visitCount{space, bots, off}` where
 * the platform cannot say. People's visits alone, or every visit with bots'
 * too (`bots`), as the line asks; the split of people, likely bots,
 * verified bots and visits from before any were told apart either way
 * (@yaks/platform/visitor).
 *
 * The visits of the last day alone, which a space's Updates say at their head
 * (./updates-day.ts), are the line `dayVisits(space)`, answered the same way
 * as `visitDay{space, app, views}` an app, or one `visitDay{space, off}`.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'
import type { Split } from './visitor.ts'

/** A day's views, or a name (a page, a site, a country) and its views. */
export type Day = { day: string; views: number }
export type Line = { name: string; views: number }

/** One app's views over the last `days`: people's alone, or every visit
 * where `bots`. */
export type Counted = {
  days: number
  bots: boolean
  total: number
  split: Split
  daily: Day[]
  pages: Line[]
  from: Line[]
  countries: Line[]
}

let COUNTS = /^\.visitCount\.space=([^&]+)&\.visitCount\.bots=(true|false)$/

/** The visits to the apps of the space `eid`: people's, or every one where
 * `bots`. */
/// visitCounts('s1') -> '.visitCount.space=s1&.visitCount.bots=false'
export let visitCounts = (eid: string, bots = false): string =>
  `.visitCount.space=${eid}&.visitCount.bots=${bots}`

/** The space a `visitCounts` line asks about and whether it asks for bots'
 * visits too, or undefined for another line. */
/// countsSpace(visitCounts('s1', true)) -> { space: 's1', bots: true }
/// countsSpace('.visitDay.space=s1') -> undefined
export let countsSpace = (
  line: string,
): { space: string; bots: boolean } | undefined => {
  let m = COUNTS.exec(line)
  return m ? { space: m[1], bots: m[2] == 'true' } : undefined
}

let DAY = '.visitDay.space='

/** The visits to the apps of the space `eid` in the last day. */
export let dayVisits = (eid: string): string => DAY + eid

/** The space a `dayVisits` line asks about, or undefined for another line. */
export let daySpace = (line: string): string | undefined =>
  line.startsWith(DAY) ? line.slice(DAY.length) : undefined

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
        bots: { type: 'boolean' },
        total: { type: 'integer' },
        split: {
          type: 'object',
          properties: {
            people: { type: 'integer' },
            bots: { type: 'integer' },
            verified: { type: 'integer' },
            unknown: { type: 'integer' },
          },
        },
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
    visitDay: {
      component: true,
      type: 'object',
      properties: {
        space: { type: 'string' },
        app: { type: 'string' },
        views: { type: 'integer' },
        off: { type: 'boolean' },
      },
      required: ['space'],
    },
  },
}

/** The views of each app of the space `space`, as rows: `counts` by app, or
 * null where the platform cannot say; people's, or every visit where
 * `bots`. */
export let countRows = (
  space: string,
  counts: Map<string, Counted> | null,
  bots = false,
): Bundle[] =>
  counts
    ? [...counts].map(([app, c]) => ({
      entity: { eid: derivedEid(`visit-count|${space}|${app}|${bots}`) },
      visitCount: {
        space,
        app,
        days: c.days,
        bots,
        total: c.total,
        split: c.split,
        daily: c.daily,
        pages: c.pages,
        from: c.from,
        countries: c.countries,
      },
    }))
    : [{
      entity: { eid: derivedEid(`visits-off|${space}|${bots}`) },
      visitCount: { space, bots, off: true },
    }]

/** The views `rows` hold of each app of `space`, people's or every visit
 * (`bots`), by app; null where they say the platform cannot count them. */
export let countsOf = (
  rows: Bundle[],
  space: string,
  bots = false,
): Map<string, Counted> | null => {
  let all = new Map<string, Counted>()
  for (let r of rows) {
    let c = r.visitCount as
      | (Counted & { space: string; app?: string; off?: boolean })
      | undefined
    if (c?.space != space || !!c.bots != bots) continue
    if (c.off) return null
    let { space: _, app, off: _off, ...counted } = c
    if (app) all.set(app, counted)
  }
  return all
}

/** The last day's views of each app of the space `space`, as rows: `views`
 * by app, or null where the platform cannot say. */
export let dayRows = (
  space: string,
  views: Map<string, number> | null,
): Bundle[] =>
  views
    ? [...views].map(([app, n]) => ({
      entity: { eid: derivedEid(`visit-day|${space}|${app}`) },
      visitDay: { space, app, views: n },
    }))
    : [{
      entity: { eid: derivedEid(`visit-day-off|${space}`) },
      visitDay: { space, off: true },
    }]

/** The last day's views `rows` hold of each app of `space`, by app; null
 * where they say the platform cannot count them. */
/// dayOf(dayRows('s', new Map([['a', 3]])), 's')?.get('a') -> 3
/// dayOf(dayRows('s', null), 's') -> null
export let dayOf = (
  rows: Bundle[],
  space: string,
): Map<string, number> | null => {
  let all = new Map<string, number>()
  for (let r of rows) {
    let d = r.visitDay as
      | { space: string; app?: string; views?: number; off?: boolean }
      | undefined
    if (d?.space != space) continue
    if (d.off) return null
    if (d.app) all.set(d.app, d.views ?? 0)
  }
  return all
}
