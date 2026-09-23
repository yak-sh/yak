// How one operand tests against one property value, in memory. This mirrors the
// SQL fragments a @yaks/sql dialect emits for the same predicates: where the
// dialect returns a SQL fragment, this returns a JavaScript predicate over the
// value read out of a bundle. Same grammar, same branch order, same refusals —
// so a query answered here and the same query answered by a database return the
// same rows.
//
// The rules a caller can rely on, in the order they are tried:
//   `` (equals)  an empty operand means absent; `lo..hi` is an inclusive range
//                and `lo...hi` excludes its end; `a,b` is any-of; a number
//                property compares numerically, anything else as text.
//   `!`          not-equals, where an absent property counts as different.
//   `~`          contains, case-insensitively; an empty operand means presence.
//   < <= > >=    comparisons, and an absent property never compares true.
//   exists       the property has a value.
// A time-typed property reads its operand as a time phrase first (a span, one
// edge of which the operator picks) and falls back to the plain rules when the
// operand is no phrase at all.
//
// A function here returns `null` where it cannot express the question exactly —
// a comparison against an operand the property's type cannot hold. The caller
// turns that into an `Unsupported` refusal rather than a wrong answer.

import { type Span, timeSpan } from '@yaks/query'
import type { Tag } from '@yaks/sql'

/**
 * A test over one property's value. The value is whatever the bundle holds, or
 * `null` when the property (or its whole component) is absent.
 */
export type Check = (value: unknown) => boolean

/** The operator name `check` switches on for a presence test. */
export let EXISTS = 'exists'

// The three tags that compare as numbers. Everything else compares as text.
let NUMERIC: Tag[] = ['number', 'priority', 'bool']
let numeric = (s: string): boolean => /^-?\d+(\.\d+)?$/.test(s)

// One comparison, over two values of the same type. The four ordered operators
// plus the equality a time instant asks for.
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

// A time property holds one format (an ISO 8601 timestamp), over which
// lexicographic order is chronological. A value outside the range a canonical
// timestamp falls in is not a timestamp, and never matches a time comparison.
let LO = '0000-01-01T00:00:00.000Z'
let HI = '9999-12-31T23:59:59.999Z'
let stamp = (v: unknown): v is string =>
  typeof v == 'string' && v >= LO && v <= HI

/**
 * A comparison (`<`, `<=`, `>`, `>=`) against a typed operand, or `null` where
 * the operand's type does not match the property's: text against a number
 * property, a number against a text one. An absent property never compares
 * true.
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
 * Equality: an empty operand asks for an absent (or empty) property, `lo..hi`
 * for an inclusive range and `lo...hi` for one that excludes its end, `a,b,c`
 * for any of several. Returns `null` when a bound or a list member has a type
 * the property cannot hold.
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
    // ('12.0' formats back as '12') can equal no stored number, so the exact
    // answer is a constant false.
    return numeric(value) && String(Number(value)) === value
      ? (v) => v != null && Number(v) == Number(value)
      : () => false
  }
  return (v) => v != null && String(v) == value
}

/**
 * Not-equals: everything equality does not select, including the rows whose
 * property (or whole component) is absent.
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

// ---- time phrases (a phrase names a span; the operator picks one edge) ----

let iso = (ms: number): string => new Date(ms).toISOString()
let at = (op: string, ms: number): Check => (v) => rel(String(v), iso(ms), op)
let both = (a: Check, b: Check): Check => (v) => a(v) && b(v)

// A span whose end equals its start is an instant, where the `=` branch carries
// the whole answer; a span with width answers `=` as a half-open interval.
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
 * A time-typed property against a time phrase, resolved relative to `now`. A
 * comma list of phrases is any-of under equals (none-of under not-equals);
 * anything else reads the whole operand as one phrase. Returns `null` when the
 * operand is not a time phrase, so the caller falls back to the plain rules.
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
 * The whole scalar path in one call: an operator, its operand and the
 * property's type, to a single test. Returns `null` for a question this package
 * cannot answer exactly — the caller turns that into an `Unsupported` refusal.
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
