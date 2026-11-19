// The customer goal's number (V-25): outside people who build a first app,
// by week, counted from the platform directory's rows. The funnel's "First
// apps" (./funnel.ts) is another count: a space's first app, Jeff's own among
// them, with no person to trace.
//
// - An outside person has an address of their own: not an owner of the `yak`
//   space (Jeff, the platform's admin), and not one on bot.yak.sh or
//   `.invalid` (./bots.ts).
// - An app is theirs when they made it, an agent acting for them made it
//   (`acts_for`), or a space they own made it (its Operator writes as the
//   space). An app installed from somebody else's is nobody's first.
// - A person counts once, in the week their first app was made: Monday to
//   Sunday, UTC.
//
// A space deleted since takes its apps out of the directory, so a person who
// built and left is not counted.
//
// Beside each week's count is where its people came from: the directory's
// `arrived` on each person's row (workers/yak arrivals.ts), named by the most
// telling thing it holds (`cameFrom`).
import { BOT } from './bots.ts'

type Row = { entity: { eid: string } } & Record<string, unknown>

/** The directory's rows the count reads: every person, with their address
 * and where they came from (`arrived`), member, app and agent, and the eid of
 * the `yak` space, whose owners are not outside people. */
export type Directory = {
  meta: string
  people: Row[]
  members: Row[]
  apps: Row[]
  agents: Row[]
}

/** One week, by its Monday (`YYYY-MM-DD`), how many outside people made
 * their first app in it, and how many of them came from where, the most
 * first. */
export type Week = { week: string; n: number; from: [string, number][] }

let comp = (r: Row, name: string) =>
  r[name] as Record<string, unknown> | undefined
let idOf = (v: unknown): string | undefined =>
  typeof v == 'string'
    ? v
    : (v as { eid?: string } | undefined)?.eid ?? undefined

let outside = (address: string) =>
  !address.endsWith(BOT) && !address.endsWith('.invalid')

/**
 * When each outside person made their first app, by person.
 *
 * @example
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = (eid: string, more = {}) => ({ entity: { eid }, ...more })
 * let made = (eid: string, by: string, when: string, more = {}) =>
 *   at(eid, { app: { space: 's' }, created: { by, at: when }, ...more })
 * let firsts = firstApps({
 *   meta: 'yak',
 *   people: [
 *     at('ann', { email: { address: 'ann@example.com' } }),
 *     at('jeff', { email: { address: 'jeff@example.com' } }),
 *     at('bot', { email: { address: 'probe@bot.yak.sh' } }),
 *   ],
 *   members: [
 *     at('m', { member: { space: 'yak', person: 'jeff', role: 'owner' } }),
 *     at('n', { member: { space: 's', person: { eid: 'ann' }, role: 'owner' } }),
 *   ],
 *   apps: [
 *     made('a2', 'agent', '2026-09-20T00:00:00Z'),
 *     made('a1', 's', '2026-09-18T00:00:00Z'),
 *     made('a0', 'ann', '2026-09-01T00:00:00Z', { installed: { of: 'x' } }),
 *     made('j', 'jeff', '2026-09-01T00:00:00Z'),
 *     made('b', 'bot', '2026-09-01T00:00:00Z'),
 *   ],
 *   agents: [at('agent', { acts_for: { person: 'ann' } })],
 * })
 * assertEquals(firsts, new Map([['ann', '2026-09-18T00:00:00Z']]))
 * ```
 */
export let firstApps = (d: Directory): Map<string, string> => {
  let owners = new Map<string, string[]>()
  for (let m of d.members) {
    let member = comp(m, 'member')
    let space = idOf(member?.space), person = idOf(member?.person)
    if (member?.role != 'owner' || !space || !person) continue
    owners.set(space, [...owners.get(space) ?? [], person])
  }
  let inside = new Set(owners.get(d.meta))
  let theirs = new Set(
    d.people.flatMap((p) => {
      let address = String(comp(p, 'email')?.address ?? '')
      return address && outside(address) && !inside.has(p.entity.eid)
        ? [p.entity.eid]
        : []
    }),
  )
  let agents = new Map(
    d.agents.flatMap((a) => {
      let person = idOf(comp(a, 'acts_for')?.person)
      return person ? [[a.entity.eid, person] as const] : []
    }),
  )
  let first = new Map<string, string>()
  for (let app of d.apps) {
    let made = comp(app, 'created')
    let by = idOf(made?.by), at = made?.at
    if (comp(app, 'installed') || !by || typeof at != 'string') continue
    let who = agents.has(by) ? [agents.get(by)!] : owners.get(by) ?? [by]
    for (let person of who) {
      if (!theirs.has(person)) continue
      let was = first.get(person)
      if (!was || at < was) first.set(person, at)
    }
  }
  return first
}

/**
 * Where each person came from, in a few words, by person: the campaign their
 * link named, else the app whose badge they followed (by its slug), who
 * invited them (by their address), the assistant whose connector they came
 * by, the home page they opened, or only the way in (`login`, `box`,
 * `email`, `text`). One who signed up before arrivals were kept is
 * `unknown`.
 *
 * @example
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let from = cameFrom({
 *   meta: 'yak',
 *   people: [
 *     { entity: { eid: 'ann' }, email: { address: 'ann@example.com' } },
 *     { entity: { eid: 'bo' }, arrived: { door: 'login', app: { eid: 'r' } } },
 *     { entity: { eid: 'cy' }, arrived: { door: 'invitation', inviter: 'ann' } },
 *     { entity: { eid: 'di' }, arrived: { door: 'box', page: 'church', campaign: 'meta//pilot' } },
 *   ],
 *   members: [],
 *   apps: [{ entity: { eid: 'r' }, app: { slug: 'recipes' } }],
 *   agents: [],
 * })
 * assertEquals(['ann', 'bo', 'cy', 'di'].map(from), [
 *   'unknown',
 *   'badge of recipes',
 *   'invited by ann@example.com',
 *   'campaign meta//pilot',
 * ])
 * ```
 */
export let cameFrom = (d: Directory): (person: string) => string => {
  let rows = new Map([...d.people, ...d.apps].map((r) => [r.entity.eid, r]))
  // What `eid`'s row says in `name.prop`, else the eid itself.
  let said = (eid: string, name: string, prop: string) => {
    let r = rows.get(eid)
    return String((r && comp(r, name)?.[prop]) ?? eid)
  }
  return (person) => {
    let r = rows.get(person), a = r && comp(r, 'arrived')
    if (!a) return 'unknown'
    let app = idOf(a.app), inviter = idOf(a.inviter)
    return a.campaign
      ? `campaign ${a.campaign}`
      : app
      ? `badge of ${said(app, 'app', 'slug')}`
      : inviter
      ? `invited by ${said(inviter, 'email', 'address')}`
      : a.assistant
      ? `assistant ${a.assistant}`
      : a.page
      ? `page ${a.page}`
      : String(a.door)
  }
}

let DAY = 86_400_000

/// monday('2026-11-19T12:00:00Z') -> '2026-11-16'
/// monday('2026-11-16T00:00:00Z') -> '2026-11-16'
/// monday('2026-11-15T23:59:59Z') -> '2026-11-09'
export let monday = (at: string) => {
  let t = Date.parse(at)
  let back = (new Date(t).getUTCDay() + 6) % 7
  return new Date(t - back * DAY).toISOString().slice(0, 10)
}

/**
 * Each week from the one `from` falls in to the one `to` falls in, how many
 * of `firsts` (when each person made their first app, by person) fell in it,
 * none for a week with none, and where they came from (`came`).
 *
 * @example
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let firsts = new Map([
 *   ['ann', '2026-11-03T17:08:08Z'],
 *   ['bo', '2026-11-04T00:00:00Z'],
 *   ['old', '2026-09-01T00:00:00Z'],
 * ])
 * assertEquals(
 *   weekly(firsts, '2026-10-27', '2026-11-12', () => 'login'),
 *   [
 *     { week: '2026-10-26', n: 0, from: [] },
 *     { week: '2026-11-02', n: 2, from: [['login', 2]] },
 *     { week: '2026-11-09', n: 0, from: [] },
 *   ],
 * )
 * ```
 */
export let weekly = (
  firsts: Map<string, string>,
  from: string,
  to: string,
  came: (person: string) => string = () => 'unknown',
): Week[] => {
  let counts = new Map<string, Map<string, number>>()
  for (let [person, at] of firsts) {
    let w = monday(at), source = came(person)
    let week = counts.get(w) ?? counts.set(w, new Map()).get(w)!
    week.set(source, (week.get(source) ?? 0) + 1)
  }
  let weeks: Week[] = []
  let last = monday(to)
  for (
    let t = Date.parse(monday(from));
    new Date(t).toISOString().slice(0, 10) <= last;
    t += 7 * DAY
  ) {
    let week = new Date(t).toISOString().slice(0, 10)
    let from = [...counts.get(week) ?? []]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    weeks.push({ week, n: from.reduce((n, [, k]) => n + k, 0), from })
  }
  return weeks
}

let MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')

/// weekSays('2026-09-14') -> 'Sep 14 to 20'
/// weekSays('2026-09-28') -> 'Sep 28 to Oct 4'
export let weekSays = (week: string) => {
  let day = (t: number) => new Date(t)
  let start = day(Date.parse(week)), end = day(start.getTime() + 6 * DAY)
  let month = (d: Date) => MONTHS[d.getUTCMonth()]
  return `${month(start)} ${start.getUTCDate()} to ${
    month(end) == month(start) ? '' : `${month(end)} `
  }${end.getUTCDate()}`
}

/**
 * The weeks as a table a person reads: each week, its first apps, and where
 * their people came from.
 *
 * @example
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   firstsLines([
 *     { week: '2026-09-28', n: 0, from: [] },
 *     { week: '2026-10-05', n: 3, from: [['page church', 2], ['unknown', 1]] },
 *   ]),
 *   [
 *     "Outside people's first apps by week (Monday to Sunday, UTC):",
 *     '  Week             First apps  Came from',
 *     '  Sep 28 to Oct 4  0',
 *     '  Oct 5 to 11      3           page church 2, unknown 1',
 *   ],
 * )
 * ```
 */
export let firstsLines = (weeks: Week[]): string[] => {
  let rows = [
    ['Week', 'First apps', 'Came from'],
    ...weeks.map((w) => [
      weekSays(w.week),
      String(w.n),
      w.from.map(([source, n]) => `${source} ${n}`).join(', '),
    ]),
  ]
  let wide = (i: number) => Math.max(...rows.map((r) => r[i].length))
  let [week, n] = [wide(0), wide(1)]
  return [
    "Outside people's first apps by week (Monday to Sunday, UTC):",
    ...rows.map((r) =>
      `  ${r[0].padEnd(week)}  ${r[1].padEnd(n)}  ${r[2]}`.trimEnd()
    ),
  ]
}
