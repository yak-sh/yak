// How one VALUE tests against one column value, in memory. This is the mirror
// of the value lowerings a SQL dialect emits: where the dialect answers a
// comparison as a SQL fragment, this answers it as a JavaScript predicate over
// the value read out of a bundle. Same grammar, same branch order, same
// declines — so a query answered here and the same query answered by a database
// agree row for row.
//
// The rules a caller can rely on, in the order they are tried:
//   `` (equals)  an empty operand is ABSENT; `lo..hi` is an inclusive range and
//                `lo...hi` excludes its end; `a,b` is any-of; a number column
//                compares numerically, anything else as text.
//   `!`          not-equals, where an absent column COUNTS as different.
//   `~`          contains, case-insensitively; an empty operand is presence.
//   < <= > >=    comparisons, and an absent column never compares true.
//   exists       the column has a value.
// A time-typed column reads its operand as a time PHRASE first (a span, whose
// edge the operator picks) and falls back to the plain rules when the operand
// is no phrase at all.
//
// A lowering answers `null` where it cannot express the question exactly — a
// comparison against an operand the column's type cannot hold. The caller turns
// that into a decline rather than a wrong answer.

import { type Span, timeSpan } from '@yaks/query'
import type { Tag } from '@yaks/sql'

/**
 * A test over one column's value. The value is whatever the bundle holds, or
 * `null` when the column (or its whole component) is absent.
 */
export type Check = (value: unknown) => boolean

/** The operator spelling `check` switches on: presence. */
export let EXISTS = 'exists'

// The three tags that compare as numbers. Everything else compares as text.
let NUMERIC: Tag[] = ['number', 'priority', 'bool']
let numeric = (s: string): boolean => /^-?\d+(\.\d+)?$/.test(s)

// One comparison, over two values of the same kind. The four ordered operators
// plus the equality a time INSTANT asks for.
let rel = <T extends string | number>(a: T, b: T, op: string): boolean =>
  op == '<'
    ? a < b
    : op == '<='
    ? a <= b
    : op == '>'
    ? a > b
    : op == '>='
    ? a >= b
    : a == b

// A time column holds one spelling (an ISO stamp), over which lexical order is
// chronological. A value outside the band a canonical stamp lives in is no
// stamp, and never answers a time comparison.
let LO = '0000-01-01T00:00:00.000Z'
let HI = '9999-12-31T23:59:59.999Z'
let stamp = (v: unknown): v is string =>
  typeof v == 'string' && v >= LO && v <= HI

/**
 * A comparison (`<`, `<=`, `>`, `>=`) against a typed operand, or `null` where
 * the operand does not type against the column: a word against a number column,
 * a number against a text one. An absent column never compares true.
 */
export let cmp = (op: string, value: string, tag: Tag): Check | null => {
  if (NUMERIC.includes(tag)) {
    if (!numeric(value)) return null
    let n = Number(value)
    return (v) => v != null && rel(Number(v), n, op)
  }
  if (tag == 'time') return (v) => stamp(v) && rel(v, value, op)
  if (numeric(value)) return null
  return (v) => v != null && rel(String(v), value, op)
}

/**
 * Equality: an empty operand asks for an ABSENT (or empty) column, `lo..hi` for
 * an inclusive range and `lo...hi` for one that excludes its end, `a,b,c` for
 * any of several. Answers `null` when a bound or a member does not type against
 * the column.
 */
export let eq = (value: string, tag: Tag): Check | null => {
  if (value == '') return (v) => v == null || String(v) == ''
  let r = value.match(/^(.*?)\.\.(\.?)(.*)$/s)
  if (r) {
    let [, lo, excl, hi] = r
    let low = cmp('>=', lo, tag)
    let high = cmp(excl ? '<' : '<=', hi, tag)
    if (!low || !high) return null
    return (v) => v != null && low(v) && high(v)
  }
  if (value.includes(',')) {
    let parts = value.split(',').map((p) => eq(p, tag))
    if (parts.some((p) => !p)) return null
    return (v) => parts.some((p) => p!(v))
  }
  if (NUMERIC.includes(tag)) {
    // An operand that does not survive a round trip through number formatting
    // can equal no stored number, so the exact answer is a constant false.
    return numeric(value) && String(Number(value)) === value
      ? (v) => v != null && Number(v) == Number(value)
      : () => false
  }
  return (v) => v != null && String(v) == value
}

/**
 * Not-equals: everything equality does not select, INCLUDING the rows whose
 * column (or whole component) is absent.
 */
export let ne = (value: string, tag: Tag): Check | null => {
  let hit = eq(value, tag)
  return hit && ((v) => !hit(v))
}

/**
 * Contains: a case-insensitive substring test over the value read as text. An
 * empty needle asks for presence rather than selecting everything.
 */
export let contains = (value: string): Check => {
  if (value == '') return (v) => v != null
  let needle = value.toLowerCase()
  return (v) => String(v ?? '').toLowerCase().includes(needle)
}

// ---- time phrases (a phrase names a range; the operator picks its edge) ----

let iso = (ms: number): string => new Date(ms).toISOString()
let at = (op: string, ms: number): Check => (v) => rel(String(v), iso(ms), op)
let both = (a: Check, b: Check): Check => (v) => a(v) && b(v)

// A span whose end is its start is an INSTANT, where the `=` arm carries the
// whole answer; a span with width answers `=` as a half-open band.
let edge = (op: string, s: Span): Check => {
  let point = s.end <= s.start
  return op == '<'
    ? at('<', s.start)
    : op == '<='
    ? point ? at('<=', s.start) : at('<', s.end)
    : op == '>'
    ? point ? at('>', s.start) : at('>=', s.end)
    : op == '>='
    ? at('>=', s.start)
    : point
    ? at('=', s.start)
    : both(at('>=', s.start), at('<', s.end))
}

/**
 * A time-typed column against a time PHRASE, resolved at the moment `now`. A
 * comma list of phrases is any-of under equals (none-of under not-equals);
 * anything else reads the whole operand as one phrase. Answers `null` when the
 * operand is no time phrase, so the caller falls back to the plain rules.
 */
export let time = (op: string, value: string, now: number): Check | null => {
  let phrase = (s: string) => timeSpan(s, now)
  let spans = value.split(',').map(phrase)
  if (spans.every((s) => s) && (op == '' || op == '!')) {
    let arms = spans.map((s) => edge('', s!))
    let hit: Check = (v) => stamp(v) && arms.some((a) => a(v))
    return op == '' ? hit : (v) => !hit(v)
  }
  let s = phrase(value)
  if (!s) return null
  let arm = edge(op, s)
  return (v) => stamp(v) && arm(v)
}

/**
 * The whole scalar road: an operator, its operand and the column's type, to one
 * test. Answers `null` for a question this package cannot answer exactly — the
 * caller reports that as a decline.
 */
export let check = (
  op: string,
  value: string,
  tag: Tag,
  now: number,
): Check | null => {
  if (op == EXISTS) return (v) => v != null
  if (tag == 'time' && op != '~') {
    let t = time(op, value, now)
    if (t) return t
  }
  if (op == '') return eq(value, tag)
  if (op == '!') return ne(value, tag)
  if (op == '~') return contains(value)
  if (['<', '<=', '>', '>='].includes(op)) {
    let inner = cmp(op, value, tag)
    return inner && ((v) => v != null && inner(v))
  }
  return null
}
