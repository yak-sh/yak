// RFC 5545 VTIMEZONE components, derived from the platform's IANA data so a
// feed defines the TZIDs it uses.
import { TZDateMini } from '@date-fns/tz'

let MINUTE = 60_000, DAY = 24 * 60 * MINUTE
let WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
let pad = (n: number, width = 2) => String(n).padStart(width, '0')

// The UTC offset in effect at an instant, in milliseconds.
let offset = (ms: number, zone: string) =>
  -new TZDateMini(ms, zone).getTimezoneOffset() * MINUTE

/** A change of UTC offset, with the wall clock just before it as a UTC date. */
type Change = { from: number; to: number; wall: Date; at: number }

// The changes within a year, found by day and then bisected to the minute.
let changes = (zone: string, year: number): Change[] => {
  let found: Change[] = []
  for (
    let day = Date.UTC(year, 0, 1);
    day < Date.UTC(year + 1, 0, 1);
    day += DAY
  ) {
    let from = offset(day, zone), to = offset(day + DAY, zone)
    if (from == to) continue
    let [lo, hi] = [day, day + DAY]
    while (hi - lo > MINUTE) {
      let mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE
      if (offset(mid, zone) == from) lo = mid
      else hi = mid
    }
    found.push({ from, to, at: hi, wall: new Date(hi + from) })
  }
  return found
}

// "The nth (or last) weekday of a month, at a time", which a change follows each year.
type Rule = { month: number; weekday: number; nth: number; time: string }
let ruleOf = ({ wall }: Change): Rule => {
  let date = wall.getUTCDate()
  let end = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 0))
  return {
    month: wall.getUTCMonth() + 1,
    weekday: wall.getUTCDay(),
    nth: date + 7 > end.getUTCDate() ? -1 : Math.ceil(date / 7),
    time: `${pad(wall.getUTCHours())}${pad(wall.getUTCMinutes())}00`,
  }
}
let same = (a: Rule, b: Rule) => JSON.stringify(a) == JSON.stringify(b)

// The rule's first date in 1970, the DTSTART that makes the rule cover every year since.
let first = ({ month, weekday, nth, time }: Rule) => {
  let from = nth < 0
    ? new Date(Date.UTC(1970, month, 0))
    : new Date(Date.UTC(1970, month - 1, 1))
  let shift = nth < 0
    ? -((from.getUTCDay() - weekday + 7) % 7)
    : (weekday - from.getUTCDay() + 7) % 7 + (nth - 1) * 7
  return `1970${pad(month)}${pad(from.getUTCDate() + shift)}T${time}`
}

let clock = (wall: Date) => wall.toISOString().replace(/[-:]/g, '').slice(0, 15)
let hhmm = (ms: number) => {
  let minutes = Math.abs(ms) / MINUTE
  return `${ms < 0 ? '-' : '+'}${pad(Math.floor(minutes / 60))}${
    pad(minutes % 60)
  }`
}
let name = (zone: string, at: number) => {
  let short = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'short',
  })
    .formatToParts(at).find((part) => part.type == 'timeZoneName')?.value
  return short && /^[A-Z]+$/.test(short) ? [`TZNAME:${short}`] : []
}

let observance = (zone: string, c: Change, start: string, rrule?: string) => {
  let kind = c.to > c.from ? 'DAYLIGHT' : 'STANDARD'
  return [
    `BEGIN:${kind}`,
    `TZOFFSETFROM:${hhmm(c.from)}`,
    `TZOFFSETTO:${hhmm(c.to)}`,
    ...name(zone, c.at),
    `DTSTART:${start}`,
    ...(rrule ? [`RRULE:${rrule}`] : []),
    `END:${kind}`,
  ]
}

/** The VTIMEZONE lines for an IANA zone as it stands in `year`. A zone that
 * never changes offset gets one fixed observance. One whose changes repeat on
 * the same weekday rule in the years either side gets that rule. Any other
 * lists that year's changes alone. */
export let vtimezone = (zone: string, year: number): string[] => {
  let now = changes(zone, year)
  let around = [year - 1, year + 1].map((y) => changes(zone, y))
  let steady = now.length > 0 &&
    around.every((other) =>
      other.length == now.length &&
      other.every((c, i) => same(ruleOf(c), ruleOf(now[i])))
    )
  let body = now.length == 0
    ? (() => {
      let at = Date.UTC(year, 0, 1), fixed = offset(at, zone)
      return observance(zone, {
        from: fixed,
        to: fixed,
        at,
        wall: new Date(at),
      }, '19700101T000000')
    })()
    : now.flatMap((c) => {
      if (!steady) return observance(zone, c, clock(c.wall))
      let rule = ruleOf(c)
      let by = `${rule.nth}${WEEKDAYS[rule.weekday]}`
      return observance(
        zone,
        c,
        first(rule),
        `FREQ=YEARLY;BYMONTH=${rule.month};BYDAY=${by}`,
      )
    })
  return ['BEGIN:VTIMEZONE', `TZID:${zone}`, ...body, 'END:VTIMEZONE']
}
