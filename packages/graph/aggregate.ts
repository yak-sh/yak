// The three query clauses that reduce a selection to a value instead of
// naming its members, and that value in the one shape every door answers
// with: `/query` as its response body, a subscription as its frame, the
// `graph_query` tool as its `$said` bundle. It sits beside `Graph.rows`,
// whose rows it reduces.

import type { Query } from '@yaks/query'
import type { Row } from './storage.ts'

/** A reduction a query can ask for. */
export type Agg = 'count' | 'distinct' | 'tally'

/** What a reduction answers: `{count: n}`, `{distinct: […]}` or
 * `{tally: {value: n}}`. */
export type Reduced =
  | { count: number }
  | { distinct: string[] }
  | { tally: Record<string, number> }

let AGGS = new Set(['count', 'distinct', 'tally'])

/** The reduction a parsed query asks for, if it asks for one. A query carrying
 * one is asking a different question, so a door reads it off before anything
 * gathers a bundle nobody asked for. */
export let aggregate = (ast: Query): Agg | undefined =>
  ast.clauses.find((c) => AGGS.has(c.kind))?.kind as Agg | undefined

// Values in order: a number by its size and before any text (a property
// tallies as numbers or as text, @yaks/sql `tallied`), a text as a string.
let before = (a: unknown, b: unknown): number =>
  typeof a == 'number' && typeof b == 'number'
    ? a - b
    : typeof a == 'number'
    ? -1
    : typeof b == 'number'
    ? 1
    : String(a) < String(b)
    ? -1
    : String(a) > String(b)
    ? 1
    : 0

/** A reduction's rows as its answer. The compiled statement returns one
 * `{value, n}` row per value (`.count` under the empty key, since no tally
 * keeps an empty one). Sorted by value, so two stores answering the same
 * question answer in the same order, and each value written as JavaScript
 * writes it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 *
 * let rows = [{ value: 12, n: 1 }, { value: -2, n: 3 }, { value: 7.5, n: 1 }]
 * assertEquals(reduced('distinct', rows), { distinct: ['-2', '7.5', '12'] })
 * ```
 */
export let reduced = (op: Agg, rows: Row[]): Reduced => {
  if (op == 'count') return { count: Number(rows[0]?.n ?? 0) }
  let sorted = rows.toSorted((a, b) => before(a.value, b.value))
  let values = sorted.map((r) => String(r.value))
  if (op == 'distinct') return { distinct: values }
  return {
    tally: Object.fromEntries(
      sorted.map((r, i) => [values[i], Number(r.n ?? 0)]),
    ),
  }
}
