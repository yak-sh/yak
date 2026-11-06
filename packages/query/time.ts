// The query half of time: what a comparison against a time phrase asks of a
// stamp, and whether a query's answer moves with the clock. The phrases
// themselves are @yaks/vocab's (`timeSpan`), the one grammar every door reads a
// time in.

import type { Clause, Pred, Value } from './ast.ts'
import { type Span, timeSpan } from '@yaks/vocab/time'
export {
  isTimeLiteral,
  type Span,
  timeInstant,
  timeSpan,
  unitMs,
} from '@yaks/vocab/time'

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

let typedItem = (v: Value, now: number): Edge[] | null => {
  if (v.kind == 'list') return null
  if (v.kind == 'range') {
    if (!('raw' in v.lo) || !('raw' in v.hi)) return null
    let lo = timeSpan(v.lo.raw, now), hi = timeSpan(v.hi.raw, now)
    return lo && hi &&
      [...edges('>=', lo), ...edges(v.exclusiveEnd ? '<' : '<=', hi)]
  }
  let sp = timeSpan(v.raw, now)
  return sp && edges('=', sp)
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
  value: string | Value,
  now: number = Date.now(),
): Edge[][] | null => {
  if (!OPS.includes(op)) return null
  if (op != '=') {
    if (typeof value != 'string' && !('raw' in value)) return null
    let sp = timeSpan(typeof value == 'string' ? value : value.raw, now)
    return sp && [edges(op, sp)]
  }
  if (typeof value != 'string' && value.kind == 'list') {
    let arms = value.items.map((v) => timeEdges('=', v, now))
    return arms.length && arms.every((a): a is Edge[][] => a != null)
      ? arms.flat()
      : null
  }
  let arms = typeof value == 'string'
    ? value.split(',').map((s) => item(s, now))
    : [typedItem(value, now)]
  return arms.every((a): a is Edge[] => a != null) ? arms : null
}

/**
 * Whether a query's answer can move with the clock alone: a predicate on a time
 * or number property whose value is a phrase (`1 hour ago`) naming another
 * instant a year on. `scalar` says what a predicate's path holds; one it
 * throws for, a path nothing declares, may hold anything and so drifts.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * import { drifts, parse } from '@yaks/query'
 *
 * let scalar = () => 'time'
 * assert(drifts(parse('.item.at>today'), scalar))
 * assert(!drifts(parse('.item.at>2026-01-01'), scalar))
 * ```
 */
export let drifts = (
  q: Clause,
  scalar: (p: Pred) => string | undefined,
  now: number = Date.now(),
): boolean => {
  let visit = (c: Clause): boolean => {
    if (c.kind == 'and' || c.kind == 'or') return c.clauses.some(visit)
    if (c.kind != 'pred') return false
    if (c.where && visit(c.where)) return true
    if (!c.value) return false
    let type
    try {
      type = scalar(c)
    } catch {
      return true
    }
    if (type != 'time' && type != 'number') return false
    let op = c.op == '!=' ? '=' : c.op, value = c.value
    let key = `${op} ${JSON.stringify(value)}`, held = drifting.get(key)
    if (held != null) return held
    held = JSON.stringify(timeEdges(op, value, now)) !=
      JSON.stringify(timeEdges(op, value, now + 366 * 86_400_000))
    if (drifting.size >= 1024) drifting.delete(drifting.keys().next().value!)
    drifting.set(key, held)
    return held
  }
  return visit(q)
}

// Whether a comparison drifts is a fact about its operator and value, never
// the moment it is asked: a phrase names an instant relative to the clock
// wherever it is read, an instant is the same everywhere. A store asks it of
// every read, so each answer is kept.
let drifting = new Map<string, boolean>()
