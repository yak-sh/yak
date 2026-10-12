// A stable numeric key selects a value through balanced comparisons. Selected
// payloads stay ordinary row expressions; the helper introduces no SQL scope.
import { and, eq, type Expr, fn, lit, op, or, when } from './ast.ts'

let parameters = (v: unknown): boolean => {
  if (!v || typeof v != 'object') return false
  if (Array.isArray(v)) return v.some(parameters)
  let node = v as Record<string, unknown>
  if (node.t == 'val') return true
  if (node.t == 'raw') return (node.params as unknown[]).length > 0
  return node.t != 'lit' && Object.values(node).some(parameters)
}

/** Look up a numeric key. The first duplicate wins; null and non-numeric keys
 * miss. Only the selected value or `missing` is evaluated.
 *
 * The required `stable` capability permits reading the key more than once:
 * the caller guarantees its value and numeric type cannot change during the
 * row, including after SQL query flattening. Stored integer owner ids satisfy
 * that contract. */
export let lookup = (
  key: Expr,
  arms: readonly (readonly [number | null, Expr])[],
  _opts: { stable: true },
  missing: Expr = lit(null),
): Expr => {
  let first = new Map<number, Expr>()
  for (let [n, value] of arms) {
    if (n == null) continue
    if (!Number.isFinite(n)) {
      throw new Error('lookup keys must be finite numbers')
    }
    if (!first.has(n)) first.set(n, value)
  }
  let entries = [...first].sort(([a], [b]) => a - b)
  let branch = (
    lo: number,
    hi: number,
    fallback: Expr,
    membership = false,
  ): Expr => {
    if (hi - lo <= 4) {
      return hi == lo ? fallback : when(
        entries.slice(lo, hi).map(([n, value]) => [
          lit(n),
          membership ? lit(true) : value,
        ]),
        fallback,
        key,
      )
    }
    let mid = (lo + hi) >> 1
    return when(
      [[
        op('<', key, lit(entries[mid][0])),
        branch(lo, mid, fallback, membership),
      ]],
      branch(mid, hi, fallback, membership),
    )
  }
  let numeric = or(
    eq(fn('typeof', key), lit('integer')),
    eq(fn('typeof', key), lit('real')),
  )
  // A bound default occurs once. Membership is a separate balanced guard so
  // a missing key and a selected null payload remain distinct, and the default
  // stays in its row's expression rather than an independently cached CTE.
  let bound = parameters(missing)
  let hit = bound
    ? and(numeric, branch(0, entries.length, lit(false), true))
    : numeric
  return when([[
    hit,
    branch(0, entries.length, bound ? lit(null) : missing),
  ]], missing)
}
