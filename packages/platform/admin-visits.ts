/**
 * The platform's visits, every space's and app's together, for the admin's
 * Visits page (./admin-visits-view.ts). They come from the same page views an
 * app's people see (./visit-counts.ts), counted by Cloudflare's analytics in
 * two answers across every app at once (yaks.app's views.ts `tallied`): the
 * views of each day by the space they were served under and the kind of
 * visit, and each app's views by the kind of visit. No store is read.
 *
 * Here those answers are told apart, as an app's Who visited tells them
 * (@yaks/platform/visitor `split`): people, likely bots, verified bots and
 * the visits from before they were told apart;
 * and the platform's own test spaces (their every member a test account) from
 * everyone's.
 *
 * ```ts
 * import { platformVisits } from '@yaks/platform/admin-visits'
 * import { equal } from '@yaks/testing'
 *
 * let v = platformVisits({
 *   at: '2026-11-28T12:00:00Z',
 *   days: 2,
 *   daily: [
 *     { day: '2026-11-28 00:00:00', space: 'ada', kind: 'browser', views: 5 },
 *     { day: '2026-11-28 00:00:00', space: 'ada', kind: 'person', views: 3 },
 *     { day: '2026-11-28 00:00:00', space: 'ada', kind: 'verified', views: 1 },
 *     { day: '2026-11-27 00:00:00', space: 'checks', kind: 'early', views: 9 },
 *   ],
 *   apps: [
 *     { app: 'a1', kind: 'browser', views: 5 },
 *     { app: 'a1', kind: 'person', views: 3 },
 *   ],
 * }, {
 *   spaces: [
 *     { eid: 's1', slug: 'ada', test: false },
 *     { eid: 's2', slug: 'checks', test: true },
 *   ],
 *   apps: [{ eid: 'a1', slug: 'notes', space: 's1' }],
 * })
 * equal(v.people.map((d) => d.views), [0, 3])
 * equal(v.bots.map((d) => d.views), [0, 2])
 * equal(v.verified.map((d) => d.views), [0, 1])
 * equal(v.tests.split.unknown, 9)
 * equal(v.apps[0], {
 *   eid: 'a1', space: 's1', name: 'ada/notes',
 *   people: 3, bots: 2, verified: 0, unknown: 0,
 * })
 * ```
 *
 * @module
 */
import { type ByDay, series } from '@yaks/ui/chart'
import type { Day } from './visit-counts.ts'
import { all, type Split, split } from './visitor.ts'

/** One day's views of one space by one kind of visit
 * (@yaks/platform/visitor `kindOf`), as Cloudflare answers it: the day a
 * DateTime, `2026-11-26 00:00:00`. */
export type DayTally = {
  day: string
  space: string
  kind: string
  views: number
}

/** One app's views over the window by one kind of visit. */
export type AppTally = { app: string; kind: string; views: number }

/** What the analytics answered for every app, and when it was asked. */
export type Tallied = {
  at: string
  days: number
  daily: DayTally[]
  apps: AppTally[]
}

/** The spaces and apps the directory holds, which the tallies name: a space
 * by the slug its views were served under, an app by its eid. */
export type Places = {
  spaces: { eid: string; slug: string; test: boolean }[]
  apps: { eid: string; slug: string; space: string }[]
}

/** A space or an app and its views over the window, split. `space` is the
 * space it opens on. */
export type Place = { eid: string; space: string; name: string } & Split

/** The platform's visits over the window, test spaces apart. */
export type PlatformVisits = {
  at: string
  days: number
  /** People's views a day, oldest first. */
  people: Day[]
  /** Likely bots' views a day. */
  bots: Day[]
  /** Verified bots' views a day. */
  verified: Day[]
  /** The views a day from before people and bots were told apart. */
  unknown: Day[]
  /** The spaces and apps people opened most, or that had the most visits
   * where bots are counted too. */
  spaces: Place[]
  apps: Place[]
  /** The test spaces' own views, and the spaces that had them. */
  tests: { split: Split; spaces: Place[] }
}

/** How many spaces and apps each list names. */
export let TOP = 20

let DAY = 86_400_000
let ymd = (t: number) => new Date(t).toISOString().slice(0, 10)

// A dense run of days from what each day held.
let dense = (byDay: ByDay, days: number, now: number): Day[] => {
  let { from, values } = series(byDay, days, now)
  let start = Date.parse(from)
  return values.map((views, i) => ({ day: ymd(start + i * DAY), views }))
}

// Views by kind, added up under a key.
type Kinds = Map<string, Record<string, number>>
let add = (into: Kinds, key: string, kind: string, views: number) => {
  let of = into.get(key) ?? {}
  of[kind] = (of[kind] ?? 0) + views
  into.set(key, of)
}

let busiest = (places: Iterable<Place>, by: (p: Place) => number) =>
  [...places].filter((p) => all(p) > 0)
    .sort((a, b) => by(b) - by(a) || all(b) - all(a))

/** The visits `t` counted, told apart by `places`, the busiest places by
 * people's visits, or by every visit where `bots`. A view of a space the
 * directory no longer names counts as everyone's; an app it no longer names
 * is in the totals but no list. */
export let platformVisits = (
  t: Tallied,
  places: Places,
  bots = false,
): PlatformVisits => {
  let now = Date.parse(t.at)
  let bySlug = new Map(places.spaces.map((s) => [s.slug, s]))
  let spaces = new Map(places.spaces.map((s) => [s.eid, s]))
  let days: Kinds = new Map()
  let tested: Record<string, number> = {}
  for (let r of t.daily) {
    if (bySlug.get(r.space)?.test) {
      tested[r.kind] = (tested[r.kind] ?? 0) + r.views
    } else add(days, r.day.slice(0, 10), r.kind, r.views)
  }
  let byApp: Kinds = new Map()
  let bySpace: Kinds = new Map()
  let spaceOf = new Map(places.apps.map((a) => [a.eid, a.space]))
  for (let r of t.apps) {
    let space = spaceOf.get(r.app)
    if (space == undefined) continue
    add(byApp, r.app, r.kind, r.views)
    add(bySpace, space, r.kind, r.views)
  }
  let place = (eid: string, space: string, name: string, of: Kinds) => ({
    eid,
    space,
    name,
    ...split(of.get(eid) ?? {}),
  })
  let inSpace = places.spaces.map((s) => place(s.eid, s.eid, s.slug, bySpace))
  let apps = places.apps.map((a) =>
    place(
      a.eid,
      a.space,
      `${spaces.get(a.space)?.slug ?? '?'}/${a.slug}`,
      byApp,
    )
  )
  let perDay = (pick: (s: Split) => number) =>
    dense(
      Object.fromEntries([...days].map(([day, of]) => [day, pick(split(of))])),
      t.days,
      now,
    )
  let test = (p: Place) => !!spaces.get(p.space)?.test
  let by = bots ? all : (p: Place) => p.people
  return {
    at: t.at,
    days: t.days,
    people: perDay((s) => s.people),
    bots: perDay((s) => s.bots),
    verified: perDay((s) => s.verified),
    unknown: perDay((s) => s.unknown),
    spaces: busiest(inSpace, by).filter((p) => !test(p)).slice(0, TOP),
    apps: busiest(apps, by).filter((p) => !test(p)).slice(0, TOP),
    tests: {
      split: split(tested),
      spaces: busiest(inSpace, all).filter(test).slice(0, TOP),
    },
  }
}

/** How long ago `at` was counted, for the page to say how old its figures
 * are. */
/// counted('2026-11-26T12:00:00Z', Date.parse('2026-11-26T12:00:30Z')) -> 'counted just now'
/// counted('2026-11-26T12:00:00Z', Date.parse('2026-11-26T12:04:00Z')) -> 'counted 4 minutes ago'
/// counted('2026-11-26T12:00:00Z', Date.parse('2026-11-26T15:00:00Z')) -> 'counted 3 hours ago'
export let counted = (at: string, now = Date.now()) => {
  let minutes = Math.floor((now - Date.parse(at)) / 60_000)
  return minutes < 1
    ? 'counted just now'
    : minutes < 120
    ? `counted ${minutes} minute${minutes == 1 ? '' : 's'} ago`
    : `counted ${Math.floor(minutes / 60)} hours ago`
}
