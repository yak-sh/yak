// The fleet's time DISPLAY and RECURRENCE: a stamp shown relative or local, and
// the next firing of a schedule. The phrase grammar (today, 1 hour ago, 9am)
// lives in @yaks/query as timeSpan/timeInstant; nothing here parses one.
import { unitMs } from '@yaks/query'

let SIZES: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]
let rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export let relative = (iso?: string | null, now = Date.now()) => {
  if (!iso) return ''
  let s = (now - Date.parse(iso)) / 1000
  for (let [unit, size] of SIZES) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(-s / size), unit)
  }
  return 'just now'
}

// A stored UTC stamp SHOWN in the running machine's local zone: ISO-8601
// with the local offset where the `Z` was, so `wake.at` reads as the wall
// clock an operator keeps while storage and wire stay Zulu. THE display face
// of a `time` prop — formatProp routes every stamp through here, and the CLI
// surfaces that print a stamp outside a prop (created/modified, comments, the
// journal) call it directly; the web feeds relative() from its minute tick.
// A non-stamp passes through untouched, so a malformed value never vanishes.
let pad = (n: number) => String(n).padStart(2, '0')
export let local = (iso: string): string => {
  let d = new Date(iso)
  if (Number.isNaN(+d)) return iso
  let off = -d.getTimezoneOffset() // minutes east of UTC
  let zone = `${off < 0 ? '-' : '+'}${pad(Math.abs(off) / 60 | 0)}:${
    pad(Math.abs(off) % 60)
  }`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${zone}`
}

// ——— Recurrence (T-18724, D-18722 part B prereq) ———
// instant() resolves ONE phrase; a schedule needs the NEXT occurrence.
// next() names the first instant at-or-after `now` that a schedule fires:
//   'every 15m' / 'every 1h' / 'every hour' — the epoch-aligned grid, so a
//     cadence is drift-free and whole units land clock-aligned; units run
//     second..week (fixed sizes only — calendar cadence is cron's job).
//   '0 9 * * *' — 5-field cron in LOCAL time: * , - / steps, dow 0-7
//     (7 = Sunday), and the standard OR rule when BOTH dom and dow are
//     restricted.
// Anything else is null, so a caller stamps the schedule unreadable
// (M-16612) instead of silently never firing.

// One cron field as the set of admitted values. null = unparseable.
let cronField = (
  s: string,
  lo: number,
  hi: number,
): { set: Set<number>; all: boolean } | null => {
  let set = new Set<number>()
  let all = s == '*'
  for (let part of s.split(',')) {
    let m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/)
    if (!m) return null
    let [, range, step] = m
    let by = step == null ? 1 : +step
    if (by < 1) return null
    let [a, b] = range == '*'
      ? [lo, hi]
      : range.includes('-')
      ? range.split('-').map(Number)
      : [+range, step == null ? +range : hi]
    if (a < lo || b > hi || a > b) return null
    for (let v = a; v <= b; v += by) set.add(v)
  }
  // dow 7 is Sunday's second name.
  if (hi == 7 && set.delete(7)) set.add(0)
  return { set, all }
}

// The bound keeps a never-matching pattern ('0 9 30 2 *') an error instead
// of a scan: four years covers every leap-year date.
let CRON_DAYS = 1462

let cronNext = (fields: string[], now: number): number | null => {
  let [mi, h, dom, mo, dow] = [
    cronField(fields[0], 0, 59),
    cronField(fields[1], 0, 23),
    cronField(fields[2], 1, 31),
    cronField(fields[3], 1, 12),
    cronField(fields[4], 0, 7),
  ]
  if (!mi || !h || !dom || !mo || !dow) return null
  // Cron speaks minutes: at-or-after rounds up to the next whole minute,
  // keeping an exact boundary (:00.000) a match for its own tick.
  let t0 = new Date(Math.ceil(now / 60_000) * 60_000)
  let minutes = [...mi.set].sort((a, b) => a - b)
  let hours = [...h.set].sort((a, b) => a - b)
  for (let day = 0; day < CRON_DAYS; day++) {
    let d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + day)
    if (!mo.set.has(d.getMonth() + 1)) continue
    // Standard cron: both restricted = either matches; else the one rules.
    let dayOk = !dom.all && !dow.all
      ? dom.set.has(d.getDate()) || dow.set.has(d.getDay())
      : dom.set.has(d.getDate()) && dow.set.has(d.getDay())
    if (!dayOk) continue
    for (let hh of hours) {
      if (day == 0 && hh < t0.getHours()) continue
      for (let mm of minutes) {
        if (day == 0 && hh == t0.getHours() && mm < t0.getMinutes()) continue
        let at = +new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm)
        if (at >= now) return at
      }
    }
  }
  return null
}

export let next = (s: string, now = Date.now()): number | null => {
  let t = s.trim().toLowerCase().replace(/\s+/g, ' ')
  let m = t.match(/^every (?:(\d+) ?)?([a-z]+)$/)
  if (m) {
    let ms = unitMs(m[2])
    let n = +(m[1] ?? 1)
    if (!ms || n < 1) return null
    let step = n * ms
    return Math.ceil(now / step) * step
  }
  let fields = t.split(' ')
  return fields.length == 5 ? cronNext(fields, now) : null
}
