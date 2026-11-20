// The daily digest: one letter a morning in place of a letter per bug. It
// says what opened and what was fixed since yesterday's, how long the fixes
// took, what is still open and who is on it, and which of them reached a
// person, above a chart of the last two weeks. It is written from the bug
// rows alone; agents heard of each bug when it opened (@yaks/heal).

import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { next } from '@yaks/wake'
import { comp, type Desk, str } from './model.ts'
import { headline, whom } from './brief.ts'
import { fixtime, opened, span, spread } from './fixtime.ts'
import { type Day, query } from './chart.ts'
import { remoteBug } from './reading.ts'
import { and, eq, every, ge, present } from '@yaks/query'

/** The owner's time zone: the digest goes out in his morning, and its days
 * are his. */
export let ZONE = 'America/Detroit'
/** When the digest goes out. */
export let EVERY = `0 7 * * * ${ZONE}`
/** How many days the chart shows. */
export let SPAN = 14
// The most bugs a section lists; it counts the rest.
let LISTED = 15
let DAY = 86_400_000

/// day(Date.parse('2026-11-20T04:00:00Z')) -> '2026-11-19'
/** A moment's date in the owner's zone, as YYYY-MM-DD. */
export let day = (t: number, zone = ZONE): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t)

let at = (b: Bundle, name: string, prop = 'at') =>
  Date.parse(str(comp(b, name)[prop]))
let open = (b: Bundle) => !b.resolved && !b.archived
let person = (b: Bundle) => comp(b, 'bug').account == 'person'

// Each time a bug opened that its row still records: its first occurrence,
// and its latest regression.
let openings = (b: Bundle) =>
  [at(b, 'bug', 'first'), at(b, 'regressed')].filter(Number.isFinite)

/** The chart's days: the `n` days up to and including `now`'s, each with the
 * bugs that opened and were fixed on it and the median time to fix. */
export let series = (bugs: Bundle[], now: number, n = SPAN): Day[] => {
  let keys = Array.from({ length: n }, (_, i) => day(now - (n - 1 - i) * DAY))
  let days = new Map(keys.map((k) => [k, { opened: 0, fixes: [] as number[] }]))
  let on = (t: number) => Number.isFinite(t) ? days.get(day(t)) : undefined
  for (let b of bugs) {
    for (let t of openings(b)) {
      let d = on(t)
      if (d) d.opened++
    }
    let ms = fixtime(b), d = on(at(b, 'resolved'))
    if (d && ms != undefined) d.fixes.push(ms)
  }
  return keys.map((k) => {
    let { opened, fixes } = days.get(k)!
    let median = spread(fixes.map((ms) => ({ ms, of: 0 }))).median
    return {
      day: k,
      opened,
      fixed: fixes.length,
      ...median == undefined ? {} : { fix: median },
    }
  })
}

/** Where the digest's links and chart point. */
export type Places = {
  /** A bug's page. */
  bug: (eid: string) => string
  /** The chart's image, its days' query string appended. */
  chart?: string
}

// A cell holds a pipe as `\|`, and a line of its own.
let cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ')
// A bug's name in a cell: its headline, cut to a line a table holds.
let WIDE = 90
let short = (s: string) =>
  s.length > WIDE ? `${s.slice(0, WIDE - 1).trimEnd()}…` : s
let name = (b: Bundle, places: Places) =>
  `[${
    cell(short(headline(str(comp(b, 'doc').title))) || b.entity.eid.slice(0, 8))
  }](${places.bug(b.entity.eid)})`
let reached = (b: Bundle) => {
  let { account, people } = comp(b, 'bug')
  return account == 'person'
    ? `**${people ? whom(Number(people), 'person') : 'a person'}**`
    : account == 'test'
    ? 'test'
    : ''
}
let on = (b: Bundle) => str(comp(b, 'taken').task) || (b.taken ? 'taken' : '')
let table = (head: string[], rows: string[][]) =>
  [head, head.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`)
    .join('\n')
let when = (t: number) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    month: 'short',
    day: 'numeric',
  }).format(t)

/**
 * The digest of `bugs` at `now`: what opened and was fixed in the day before
 * it, what is open, and the chart of the days before that.
 *
 * ```ts
 * import { digest } from '@yaks/tracker/digest'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-11-20T12:00:00Z')
 * let { title } = digest([
 *   { entity: { eid: 'a' }, doc: { title: 'TypeError: x' }, bug: { first: '2026-11-20T09:00:00Z', hits: 2, account: 'person', people: 1 } },
 *   { entity: { eid: 'b' }, doc: { title: 'Error: y' }, bug: { first: '2026-11-19T10:00:00Z' }, resolved: { at: '2026-11-19T13:00:00Z' } },
 * ], now, { bug: (eid) => `https://bugs.example/${eid}` })
 * equal(title, 'Bugs, Nov 20: 1 new, 1 fixed, 1 open, 1 reached a person')
 * ```
 */
export let digest = (
  bugs: Bundle[],
  now: number,
  places: Places,
): { title: string; body: string } => {
  let since = now - DAY
  let hits = (b: Bundle) => Number(comp(b, 'bug').hits ?? 1)
  // A person's bugs first, then the worst by `worst`.
  let rank = (worst: (b: Bundle) => number) => (a: Bundle, b: Bundle) =>
    Number(person(b)) - Number(person(a)) || worst(b) - worst(a)
  let fresh = bugs.filter((b) => opened(b) >= since && opened(b) <= now)
    .sort(rank(hits))
  let fixed = bugs.filter((b) =>
    at(b, 'resolved') >= since && fixtime(b) != undefined
  ).sort(rank((b) => fixtime(b)!))
  let still = bugs.filter(open).sort(rank(hits))
  let hit = new Set([...fresh, ...fixed, ...still].filter(person))
  let days = series(bugs, now)
  let fixes = spread(fixed.map((b) => ({ ms: fixtime(b)!, of: b })))
  // A section lists its first fifteen and counts the rest.
  let section = (
    head: string,
    rows: Bundle[],
    cols: string[],
    row: (b: Bundle) => string[],
    lead = '',
  ) => {
    let shown = rows.slice(0, LISTED), rest = rows.length - shown.length
    return `## ${head} (${rows.length})\n\n${
      rows.length
        ? lead + table(cols, shown.map(row)) +
          (rest ? `\n\nAnd ${rest} more.` : '')
        : 'None.'
    }`
  }
  let body = [
    ...places.chart
      ? [
        `![Bugs opened and fixed each day, and time to fix](${places.chart}${
          places.chart.includes('?') ? '&' : '?'
        }${query(days)})`,
        `Last ${SPAN} days, ${when(now - (SPAN - 1) * DAY)} to ${
          when(now)
        }: opened in red, fixed in green, and the median time to fix of each day's fixes in amber (the highest ${
          span(Math.max(1, ...days.map((d) => d.fix ?? 0)))
        }).`,
      ]
      : [],
    section(
      'New',
      fresh,
      ['Bug', 'Hits', 'Reached', 'On it'],
      (b) => [name(b, places), String(hits(b)), reached(b), on(b)],
    ),
    section(
      'Fixed',
      fixed,
      ['Bug', 'Time to fix', 'Reached'],
      (b) => [name(b, places), span(fixtime(b)!), reached(b)],
      fixes.median == undefined
        ? ''
        : `Median time to fix ${span(fixes.median)}.\n\n`,
    ),
    section(
      'Open',
      still,
      ['Bug', 'Open for', 'Hits', 'Reached', 'On it'],
      (b) => [
        name(b, places),
        span(Math.max(0, now - opened(b))),
        String(hits(b)),
        reached(b),
        on(b) || 'nobody',
      ],
    ),
  ].join('\n\n')
  return {
    title: `Bugs, ${
      when(now)
    }: ${fresh.length} new, ${fixed.length} fixed, ${still.length} open${
      hit.size ? `, ${hit.size} reached a person` : ''
    }`,
    body,
  }
}

/** The recurring wake that sends the digest each morning, from `now` on. One
 * store holds one, under a fixed eid, so writing it again moves nothing. */
export let wake = (now: number): Bundle => ({
  entity: { eid: derivedEid('tracker-digest') },
  wake: { every: EVERY, at: next(EVERY, now), note: 'The daily bug digest' },
  digest: {},
})

// What the digest reads: every open bug, and every one that opened or was
// fixed within the chart's days.
let reads = (since: string) =>
  [
    eq('bug.status', 'open'),
    ge('bug.first', since),
    ge('regressed.at', since),
    ge('resolved.at', since),
  ].map((p) => and(present('bug'), p, every()))

/** What the digest is sent with: its recipient by entity, the address it is
 * from, the tracker web's address, this store's global eid, and where its
 * chart is drawn (a `/chart.png` that reads its query string, ./chart.ts). */
export type Sending = {
  to?: string
  from?: string
  url?: string
  store?: string
  chart?: string
}

/** Write the digest due at `now` as a letter to `to`, once a day: a retried
 * firing finds the day's letter and writes nothing. */
export let send = async (
  g: Desk,
  now: number,
  { to, from, url, store, chart }: Sending,
): Promise<void> => {
  if (!to) return
  let eid = derivedEid(
    `tracker-digest|${JSON.stringify([store, to, day(now)])}`,
  )
  let [held] = await g.get([eid])
  if (held?.mail) return
  let since = new Date(now - SPAN * DAY).toISOString()
  let found = new Map<string, Bundle>()
  for (let q of reads(since)) {
    for (let b of await g.read(q)) found.set(b.entity.eid, b)
  }
  let link = (path: string) => url ? new URL(path, url).href : path
  let { title, body } = digest([...found.values()], now, {
    bug: (bug) => link(remoteBug('yaks.app', bug, { scope: store })),
    ...chart ? { chart } : {},
  })
  await g.apply([{
    entity: { eid },
    doc: { title, body },
    mail: { at: new Date(now).toISOString(), ...from ? { from } : {} },
    deliver: { to },
  }], { trusted: true })
}
