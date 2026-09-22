// Time phrases people write, resolved to numbers. A phrase names a range; a
// caller that wants a single moment takes the relevant edge of it
// (`timeInstant`). This is the schema-independent half of time in a query:
// recognizing the literal forms (today, 1 hour ago, in 60m, 9am, an ISO
// timestamp) and resolving them against a clock. It knows no column and no
// schema — deciding that a given field holds a time, and so that its scalar
// should be read through here, is for a compiler that has one.
//
// Day boundaries belong to the evaluator: a browser and a server each read the
// clock in their own local zone, so the phrase stays authored (`today` must
// advance tomorrow) and `now` rides in as a parameter tests can fix.

// `forward` marks a phrase that begins at now and names its end (`in 5m`) —
// the kind `timeInstant` reads the end of. It records how the phrase was
// written, not anything about the numbers.
export type Span = { start: number; end: number; forward?: boolean }

let UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
}

// The short forms people type: `m` is minutes and `mo` is months, by the usual
// convention; seconds are here because machines emit them.
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

// The fixed size of a unit word (`m`, `hours`, `d`), or undefined for a word
// that is no unit or a calendar one (`mo`, `y`): what a cadence grid steps by.
export let unitMs = (w: string): number | undefined => {
  let u = unit(w)
  return u ? UNIT_MS[u] : undefined
}

// A clock time carries its precision: a named hour spans its hour, a named
// minute spans its minute.
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

// A phrase to the range it names, or null when the text is no time literal at
// all — which is how a caller tells a genuine time phrase from a plain word.
export let timeSpan = (s: string, now: number = Date.now()): Span | null => {
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
    // A named zone belongs to the timestamp; a moment with no zone is local,
    // like every other day boundary in this format.
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
  // Minutes through weeks are exact; month and year shifts go by calendar.
  let shift = (n: number, u: string) =>
    u == 'month'
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
  // `in` and `after` name the same forward range.
  m = t.match(/^(?:in|after) (\d+) ?([a-z]+)$/)
  if (m && unit(m[2])) {
    let n = Number(m[1]), u = unit(m[2])!
    return {
      start: now,
      end: UNIT_MS[u] ? now + n * UNIT_MS[u] : shift(n, u),
      forward: true,
    }
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

// A yes/no over the same recognizer — is this text a time phrase at all?
export let isTimeLiteral = (s: string, now: number = Date.now()): boolean =>
  timeSpan(s, now) != null

// Forward phrases begin at now and name their end; other phrases name start.
export let timeInstant = (
  s: string,
  now: number = Date.now(),
): number | null => {
  let sp = timeSpan(s, now)
  return sp ? (sp.forward ? sp.end : sp.start) : null
}
