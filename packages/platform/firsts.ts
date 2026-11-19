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
import { BOT } from './bots.ts'

type Row = { entity: { eid: string } } & Record<string, unknown>

/** The directory's rows the count reads: every person, member, app and agent,
 * and the eid of the `yak` space, whose owners are not outside people. */
export type Directory = {
  meta: string
  people: Row[]
  members: Row[]
  apps: Row[]
  agents: Row[]
}

/** One week, by its Monday (`YYYY-MM-DD`), and how many outside people made
 * their first app in it. */
export type Week = { week: string; n: number }

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
 * Each week from the one `from` falls in to the one `to` falls in, and how
 * many of `firsts` fell in it, none for a week with none.
 *
 * @example
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   weekly(['2026-11-03T17:08:08Z', '2026-09-01T00:00:00Z'], '2026-10-27', '2026-11-12'),
 *   [
 *     { week: '2026-10-26', n: 0 },
 *     { week: '2026-11-02', n: 1 },
 *     { week: '2026-11-09', n: 0 },
 *   ],
 * )
 * ```
 */
export let weekly = (
  firsts: Iterable<string>,
  from: string,
  to: string,
): Week[] => {
  let counts = new Map<string, number>()
  for (let at of firsts) {
    let w = monday(at)
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  let weeks: Week[] = []
  let last = monday(to)
  for (
    let t = Date.parse(monday(from));
    new Date(t).toISOString().slice(0, 10) <= last;
    t += 7 * DAY
  ) {
    let week = new Date(t).toISOString().slice(0, 10)
    weeks.push({ week, n: counts.get(week) ?? 0 })
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
 * The weeks as a table a person reads: each week and its first apps.
 *
 * @example
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   firstsLines([{ week: '2026-09-28', n: 0 }, { week: '2026-10-05', n: 2 }]),
 *   [
 *     "Outside people's first apps by week (Monday to Sunday, UTC):",
 *     '  Week             First apps',
 *     '  Sep 28 to Oct 4  0',
 *     '  Oct 5 to 11      2',
 *   ],
 * )
 * ```
 */
export let firstsLines = (weeks: Week[]): string[] => {
  let rows = [
    ['Week', 'First apps'],
    ...weeks.map((w) => [weekSays(w.week), String(w.n)]),
  ]
  let wide = Math.max(...rows.map((r) => r[0].length))
  return [
    "Outside people's first apps by week (Monday to Sunday, UTC):",
    ...rows.map((r) => `  ${r[0].padEnd(wide)}  ${r[1]}`),
  ]
}
