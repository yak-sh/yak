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
// A time-typed property reads its operand as time phrases first (@yaks/query's
// `timeEdges` says what each operator asks of a stamp) and falls back to the
// plain rules when the operand is no phrase at all.
//
// A function here returns `null` where it cannot express the question exactly —
// a comparison against an operand the property's type cannot hold. The caller
// turns that into an `Unsupported` refusal rather than a wrong answer.

import { timeEdges } from '@yaks/query'
import { held, type Tag } from '@yaks/sql'

/**
 * A test over one property's value. The value is whatever the bundle holds, or
 * `null` when the property (or its whole component) is absent.
 */
export type Check = (value: unknown) => boolean

/** The operator name `check` switches on for a presence test. */
export let EXISTS = 'exists'

// The three tags that compare as numbers. Everything else compares as text.
let NUMERIC: Tag[] = ['number', 'priority', 'bool']
/** Whether an operand is written as a number, which is how a number property
 * compares it. */
export let numeric = (s: string): boolean => /^-?\d+(\.\d+)?$/.test(s)

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
    let n = held(value, tag)
    if (!numeric(n)) return null
    return (v) => v != null && rel(Number(v), Number(n), op)
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
    let n = held(value, tag)
    return numeric(n) && String(Number(n)) === n
      ? (v) => v != null && Number(v) == Number(n)
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

// ---- time phrases (@yaks/query resolves the edges; this holds a stamp to them)

let iso = (ms: number): string => new Date(ms).toISOString()

/**
 * A time-typed property against a time phrase, resolved relative to `now`, by
 * the edges @yaks/query's `timeEdges` names: a comma list of phrases or ranges
 * of them is any-of under equals (none-of under not-equals), and a comparison
 * reads the operand as one phrase. Returns `null` when the operand is not made
 * of phrases, so the caller falls back to the plain rules.
 */
export let time = (op: string, value: string, now: number): Check | null => {
  let arms = timeEdges(op == '' || op == '!' ? '=' : op, value, now)
  if (!arms) return null
  let tests = arms.map((all) =>
    all.map(([o, ms]): Check => (v) => rel(String(v), iso(ms), o))
  )
  let hit: Check = (v) =>
    stamp(v) && tests.some((all) => all.every((t) => t(v)))
  return op == '!' ? (v) => !hit(v) : hit
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
