// Time phrases people write, resolved to numbers. A phrase names a range; a
// caller that wants a single moment takes the relevant edge of it
// (`timeInstant`). This is the schema-independent half of time in a query:
// recognizing the literal forms (today, 1 hour ago, in 60m, 9am, an ISO
// timestamp) and resolving them against a clock. It knows no property and no
// schema — deciding that a given field holds a time, and so that its scalar
// should be read through here, is for a compiler that has one.
//
// Day boundaries belong to the evaluator: a browser and a server each read the
// clock in their own local zone, so the phrase stays authored (`today` must
// advance tomorrow) and `now` rides in as a parameter tests can fix.

// `at` is the moment a phrase names when it names one rather than a stretch
// (`now`, `1 hour ago`, `in 5m`); its span then runs between now and that
// moment.
export type Span = { start: number; end: number; at?: number }

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
  if (t == 'now') return { start: now, end: now, at: now }
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
    let at = UNIT_MS[u] ? now - n * UNIT_MS[u] : shift(-n, u)
    return { start: at, end: now, at }
  }
  // `in` and `after` name the same forward range.
  m = t.match(/^(?:in|after) (\d+) ?([a-z]+)$/)
  if (m && unit(m[2])) {
    let n = Number(m[1]), u = unit(m[2])!
    let at = UNIT_MS[u] ? now + n * UNIT_MS[u] : shift(n, u)
    return { start: now, end: at, at }
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

// A phrase naming a moment gives that moment; a stretch gives its start.
export let timeInstant = (
  s: string,
  now: number = Date.now(),
): number | null => {
  let sp = timeSpan(s, now)
  return sp ? sp.at ?? sp.start : null
}

/** One comparison a stamp must pass: an operator (`=`, `<`, `<=`, `>`, `>=`)
 * and the moment, in epoch ms, it compares the stamp to. */
export type Edge = [op: string, ms: number]

// One phrase under one operator. A moment compares as itself: `>1 hour ago` is
// later than an hour ago. A stretch compares as a whole: `>today` is after
// today ends, `<=today` is before it ends. Equality selects the span, half
// open, or the moment itself when it has no width: `=1 hour ago` is the last
// hour.
let edges = (op: string, s: Span): Edge[] =>
  op == '='
    ? s.end > s.start ? [['>=', s.start], ['<', s.end]] : [['=', s.start]]
    : s.at != null
    ? [[op, s.at]]
    : op == '<'
    ? [['<', s.start]]
    : op == '<='
    ? [['<', s.end]]
    : op == '>'
    ? [['>=', s.end]]
    : [['>=', s.start]]

let RANGE = /^(.*?)\.\.(\.?)(.*)$/s
let OPS = ['=', '<', '<=', '>', '>=']

// One item of an equality: a phrase, or `lo..hi` from `lo` through `hi` (`...`
// stops before `hi`), each end read as that comparison reads it.
let item = (s: string, now: number): Edge[] | null => {
  let r = s.match(RANGE)
  if (!r) {
    let sp = timeSpan(s, now)
    return sp && edges('=', sp)
  }
  let lo = timeSpan(r[1], now), hi = timeSpan(r[3], now)
  return lo && hi && [...edges('>=', lo), ...edges(r[2] ? '<' : '<=', hi)]
}

/**
 * What `op` against a time operand asks of a stamp, resolved against `now`:
 * any of the returned arms, each a list of edges that must all hold. Equality
 * reads a comma list of phrases or ranges of them as any-of; a comparison reads
 * the operand as one phrase. Null when the operand is not made of phrases, so a
 * compiler reads it by its plain rules instead.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { timeEdges } from '@yaks/query'
 *
 * let now = Date.parse('2026-07-15T12:00:00Z')
 * assertEquals(timeEdges('>', '1 hour ago', now), [[['>', now - 3_600_000]]])
 * assertEquals(timeEdges('=', 'someday', now), null)
 * ```
 */
export let timeEdges = (
  op: string,
  value: string,
  now: number = Date.now(),
): Edge[][] | null => {
  if (!OPS.includes(op)) return null
  if (op != '=') {
    let sp = timeSpan(value, now)
    return sp && [edges(op, sp)]
  }
  let arms = value.split(',').map((s) => item(s, now))
  return arms.every((a): a is Edge[] => a != null) ? arms : null
}
