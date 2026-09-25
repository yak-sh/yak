// The three query clauses that reduce a selection to a value instead of
// naming its members, and that value in the one shape every door answers
// with: `/query` as its response body, a subscription as its frame.

import type { Row } from '@yaks/graph'
import type { Query } from '@yaks/query'

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

/** A reduction's rows as its answer. The compiled statement returns one
 * `{value, n}` row per value (`.count!` under the empty key, since no tally
 * keeps an empty one). Sorted by value, so two stores answering the same
 * question answer in the same order. */
export let reduced = (op: Agg, rows: Row[]): Reduced => {
  if (op == 'count') return { count: Number(rows[0]?.n ?? 0) }
  let values = rows.map((r) => String(r.value)).sort()
  if (op == 'distinct') return { distinct: values }
  let at = new Map(rows.map((r) => [String(r.value), Number(r.n ?? 0)]))
  return { tally: Object.fromEntries(values.map((v) => [v, at.get(v)!])) }
}
