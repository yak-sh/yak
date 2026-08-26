// Human time phrases shared by scalar writes, filters, and schedulers.
// A phrase names a range; callers that need one moment take its relevant edge.

export type Span = { start: number; end: number }

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

let UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
}

// The short forms are what a hand types; m is minutes and mo is months,
// following the calendar convention. Seconds are here because machines emit
// them: `operate tokens --pace` reports its sleep in seconds, and an operator
// told to wake on that number should be able to pass it through rather than
// divide by 60 — a conversion whose failure mode is sleeping 60x too long.
let unit = (w: string): string | undefined =>
  ({
    s: 'second',
    sec: 'second',
    secs: 'second',
    m: 'minute',
    min: 'minute',
    mins: 'minute',
    h: 'hour',
    hr: 'hour',
    hrs: 'hour',
    d: 'day',
    w: 'week',
    mo: 'month',
    y: 'year',
  })[w] ??
    (/^(second|minute|hour|day|week|month|year)s?$/.test(w)
      ? w.replace(/s$/, '')
      : undefined)

// A clock time carries its precision: a named hour spans its hour and a
// named minute spans its minute.
let clock = (s: string): { h: number; m: number; exact: boolean } | null => {
  if (s == 'noon') return { h: 12, m: 0, exact: true }
  if (s == 'midnight') return { h: 0, m: 0, exact: true }
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/)
  if (m) {
    return {
      h: +m[1] % 12 + (m[3] == 'pm' ? 12 : 0),
      m: +(m[2] ?? 0),
      exact: m[2] != null,
    }
  }
  m = s.match(/^(\d{1,2}):(\d{2})$/)
  return m && +m[1] < 24 ? { h: +m[1], m: +m[2], exact: true } : null
}

// Calendar units shift by calendar, not by a fixed millisecond count. Day
// boundaries belong to the evaluator: browser and server each use local time.
export let span = (s: string, now = Date.now()): Span | null => {
  let raw = s.trim().toLowerCase()
  // Match dates before word glue: glue serves `1-hour-ago`, not ISO hyphens.
  let iso = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?(z|[+-]\d{2}:?\d{2})?)?$/,
  )
  if (iso) {
    let [, y, mo, dd, hh, mi, ss, , zone] = iso
    if (!hh) {
      return {
        start: +new Date(+y, +mo - 1, +dd),
        end: +new Date(+y, +mo - 1, +dd + 1),
      }
    }
    // A named zone belongs to the stamp; an unzoned moment is local, like
    // every other day boundary in the vocabulary.
    let start = zone
      ? Date.parse(s.trim())
      : +new Date(+y, +mo - 1, +dd, +hh, +mi, +(ss ?? 0))
    return { start, end: start + (ss ? 1000 : 60_000) }
  }
  let t = raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
  let d = new Date(now)
  let days = (a: number, b: number): Span => ({
    start: +new Date(d.getFullYear(), d.getMonth(), d.getDate() + a),
    end: +new Date(d.getFullYear(), d.getMonth(), d.getDate() + b),
  })
  // Minutes through weeks are exact. Month and year shifts take this road.
  let shift = (n: number, unit: string) =>
    unit == 'month'
      ? +new Date(
        d.getFullYear(),
        d.getMonth() + n,
        d.getDate(),
        d.getHours(),
        d.getMinutes(),
        d.getSeconds(),
      )
      : +new Date(
        d.getFullYear() + n,
        d.getMonth(),
        d.getDate(),
        d.getHours(),
        d.getMinutes(),
        d.getSeconds(),
      )
  if (t == 'now') return { start: now, end: now }
  if (t == 'today') return days(0, 1)
  if (t == 'yesterday') return days(-1, 0)
  if (t == 'tomorrow') return days(1, 2)
  let m = t.match(/^(this|last|next) (minute|hour|day|week|month|year)$/)
  if (m) {
    let at = m[1] == 'this' ? 0 : m[1] == 'last' ? -1 : 1
    let u = m[2]
    if (u == 'day') return days(at, at + 1)
    if (u == 'week') { // weeks start Monday
      let mon = d.getDate() - ((d.getDay() + 6) % 7) + at * 7
      return {
        start: +new Date(d.getFullYear(), d.getMonth(), mon),
        end: +new Date(d.getFullYear(), d.getMonth(), mon + 7),
      }
    }
    if (u == 'month') {
      return {
        start: +new Date(d.getFullYear(), d.getMonth() + at, 1),
        end: +new Date(d.getFullYear(), d.getMonth() + at + 1, 1),
      }
    }
    if (u == 'year') {
      return {
        start: +new Date(d.getFullYear() + at, 0, 1),
        end: +new Date(d.getFullYear() + at + 1, 0, 1),
      }
    }
    // A named minute/hour is floored before stepping to last or next.
    let w = UNIT_MS[u]
    let start = Math.floor(now / w) * w + at * w
    return { start, end: start + w }
  }
  m = t.match(/^(\d+) ?([a-z]+) ago$/)
  if (m && unit(m[2])) {
    let n = Number(m[1]), u = unit(m[2])!
    return { start: UNIT_MS[u] ? now - n * UNIT_MS[u] : shift(-n, u), end: now }
  }
  // `in` and `after` say the same forward range.
  m = t.match(/^(?:in|after) (\d+) ?([a-z]+)$/)
  if (m && unit(m[2])) {
    let n = Number(m[1]), u = unit(m[2])!
    return { start: now, end: UNIT_MS[u] ? now + n * UNIT_MS[u] : shift(n, u) }
  }
  // A clock is today unless a day word rides along. It never rolls forward:
  // past input stays visibly past for filters and schedulers.
  let ws = t.split(' ')
  let off: Record<string, number> = { yesterday: -1, today: 0, tomorrow: 1 }
  let day = off[ws[0]] ?? off[ws.at(-1)!]
  let c = clock(
    (day == null ? ws : off[ws[0]] == null ? ws.slice(0, -1) : ws.slice(1))
      .join(''),
  )
  if (c) {
    let start = +new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + (day ?? 0),
      c.h,
      c.m,
    )
    return { start, end: start + (c.exact ? 60_000 : 3_600_000) }
  }
  return null
}

// Forward phrases begin at now and name their end; other phrases name start.
export let instant = (s: string, now = Date.now()): number | null => {
  let sp = span(s, now)
  return sp ? (sp.start == now ? sp.end : sp.start) : null
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
    let u = unit(m[2])
    let ms = u ? UNIT_MS[u] : undefined
    let n = +(m[1] ?? 1)
    if (!ms || n < 1) return null
    let step = n * ms
    return Math.ceil(now / step) * step
  }
  let fields = t.split(' ')
  return fields.length == 5 ? cronNext(fields, now) : null
}
