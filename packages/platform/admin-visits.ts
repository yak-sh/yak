/**
 * The platform's visits, every space's and app's together, for the admin's
 * Visits page (./admin-visits-view.ts). They come from the same page views an
 * app's people see (./visit-counts.ts), counted by Cloudflare's analytics in
 * two answers across every app at once (yaks.app's views.ts `tallied`): the
 * views of each day by the space they were served under and the kind of client
 * that asked, and each app's views by the kind of client. No store is read.
 *
 * Here those answers are told apart: a person's browser from bots and agents,
 * and the platform's own test spaces (their every member a test account) from
 * everyone's.
 *
 * ```ts
 * import { platformVisits } from '@yaks/platform/admin-visits'
 * import { equal } from '@yaks/testing'
 *
 * let v = platformVisits({
 *   at: '2026-11-26T12:00:00Z',
 *   days: 2,
 *   daily: [
 *     { day: '2026-11-26 00:00:00', space: 'ada', client: 'browser', views: 3 },
 *     { day: '2026-11-26 00:00:00', space: 'ada', client: 'bot', views: 2 },
 *     { day: '2026-11-25 00:00:00', space: 'checks', client: 'browser', views: 9 },
 *   ],
 *   apps: [
 *     { app: 'a1', client: 'browser', views: 3 },
 *     { app: 't1', client: 'browser', views: 1 },
 *     { app: 't2', client: 'bot', views: 5 },
 *   ],
 * }, {
 *   spaces: [
 *     { eid: 's1', slug: 'ada', test: false },
 *     { eid: 's2', slug: 'checks', test: true },
 *     { eid: 's3', slug: 'probes', test: true },
 *   ],
 *   apps: [
 *     { eid: 'a1', slug: 'notes', space: 's1' },
 *     { eid: 't1', slug: 'try', space: 's2' },
 *     { eid: 't2', slug: 'probe', space: 's3' },
 *   ],
 * })
 * equal(v.people.map((d) => d.views), [0, 3])
 * equal(v.others.map((d) => d.views), [0, 2])
 * equal(v.tests.people, 9)
 * // A test space's every visit counts, bots' too.
 * equal(v.tests.spaces.map((p) => p.name), ['probes', 'checks'])
 * equal(v.apps[0], { eid: 'a1', space: 's1', name: 'ada/notes', people: 3, others: 0 })
 * ```
 *
 * @module
 */
import { type ByDay, series } from '@yaks/ui/chart'
import type { Day } from './visit-counts.ts'

/** One day's views of one space by one kind of client, as Cloudflare
 * answers it: the day a DateTime, `2026-11-26 00:00:00`. */
export type DayTally = {
  day: string
  space: string
  client: string
  views: number
}

/** One app's views over the window by one kind of client. */
export type AppTally = { app: string; client: string; views: number }

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

/** A space or an app and its views over the window: by people, and by bots
 * and agents. `space` is the space it opens on. */
export type Place = {
  eid: string
  space: string
  name: string
  people: number
  others: number
}

/** The platform's visits over the window, test spaces apart. */
export type PlatformVisits = {
  at: string
  days: number
  /** People's views a day, oldest first. */
  people: Day[]
  /** Bots' and agents' views a day. */
  others: Day[]
  /** The spaces and apps people opened most. */
  spaces: Place[]
  apps: Place[]
  /** The test spaces' own views, and the spaces that had them. */
  tests: { people: number; others: number; spaces: Place[] }
}

/** How many spaces and apps each list names. */
export let TOP = 20

// A person's browser is `browser` (yaks.app's crawlers.ts `classed`);
// anything else is a bot or an agent.
let sideOf = (client: string): 'people' | 'others' =>
  client == 'browser' ? 'people' : 'others'

let DAY = 86_400_000
let ymd = (t: number) => new Date(t).toISOString().slice(0, 10)

// A dense run of days from what each day held.
let dense = (byDay: ByDay, days: number, now: number): Day[] => {
  let { from, values } = series(byDay, days, now)
  let start = Date.parse(from)
  return values.map((views, i) => ({ day: ymd(start + i * DAY), views }))
}

let all = (p: Place) => p.people + p.others

// People's places by people's visits; the test spaces' by every visit.
let busiest = (places: Iterable<Place>, by = (p: Place) => p.people) =>
  [...places].filter((p) => all(p) > 0)
    .sort((a, b) => by(b) - by(a) || all(b) - all(a))

/** The visits `t` counted, told apart by `places`. A view of a space the
 * directory no longer names counts as everyone's; an app it no longer names
 * is in the totals but no list. */
export let platformVisits = (t: Tallied, places: Places): PlatformVisits => {
  let now = Date.parse(t.at)
  let bySlug = new Map(places.spaces.map((s) => [s.slug, s]))
  let spaces = new Map(places.spaces.map((s) => [s.eid, s]))
  let place = (eid: string, space: string, name: string): Place => ({
    eid,
    space,
    name,
    people: 0,
    others: 0,
  })
  let inSpace = new Map(
    places.spaces.map((s) => [s.eid, place(s.eid, s.eid, s.slug)]),
  )
  let people: ByDay = {}
  let others: ByDay = {}
  let tested = { people: 0, others: 0 }
  for (let r of t.daily) {
    let side = sideOf(r.client)
    if (bySlug.get(r.space)?.test) {
      tested[side] += r.views
      continue
    }
    let into = side == 'people' ? people : others
    let day = r.day.slice(0, 10)
    into[day] = (into[day] ?? 0) + r.views
  }
  let apps = places.apps.map((a) =>
    place(a.eid, a.space, `${spaces.get(a.space)?.slug ?? '?'}/${a.slug}`)
  )
  let appOf = new Map(apps.map((a) => [a.eid, a]))
  for (let r of t.apps) {
    let a = appOf.get(r.app)
    if (!a) continue
    let side = sideOf(r.client)
    a[side] += r.views
    let space = inSpace.get(a.space)
    if (space) space[side] += r.views
  }
  let test = (p: Place) => !!spaces.get(p.space)?.test
  return {
    at: t.at,
    days: t.days,
    people: dense(people, t.days, now),
    others: dense(others, t.days, now),
    spaces: busiest(inSpace.values()).filter((p) => !test(p)).slice(0, TOP),
    apps: busiest(apps).filter((p) => !test(p)).slice(0, TOP),
    tests: {
      ...tested,
      spaces: busiest(inSpace.values(), all).filter(test).slice(0, TOP),
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
