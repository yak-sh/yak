// What a query's filter already fixes about every row it selects. A derived
// property is computed by its expression wherever it is read, so a read that
// filters by one and then fills in the rows it found pays for it twice: once in
// the filter, for every row the filter tests, and again in the gather, for every
// row the filter kept. `.session.status=settled` computes a session's status
// from its entries, and on 21.4k sessions the second pass was half of a 7 s
// read (T-147906).
//
// A conjunct that equates the property with one of its declared values leaves
// no row with another, so the filter's value is the one every row it kept
// holds. The registry `pinned` returns reads that value, bound as a parameter,
// instead of working it out again.

import type { And, Clause } from '@yaks/query/core'
import type { Vocab } from '@yaks/vocab'
import { val } from './ast.ts'
import { alike, type Derived, derivedOf } from './derived.ts'

// The `comp.prop` each top-level conjunct pins, and the value: an equality
// with one non-empty scalar the property's declared values name, so the value
// the expression returns is that string exactly (a text comparison casts, and
// an empty operand also matches null).
let pins = (
  clauses: Clause[],
  vocab: Vocab,
  derived: Derived,
  out = new Map<string, string>(),
): Map<string, string> => {
  for (let c of clauses) {
    if (c.kind == 'and') pins(c.clauses, vocab, derived, out)
    if (
      c.kind != 'pred' || c.op != '=' || c.not || c.where ||
      c.value?.kind != 'scalar' || c.value.raw == ''
    ) continue
    let hops
    try {
      hops = vocab.aim(c.path.join('.'))
    } catch {
      continue
    }
    if (hops.length != 1 || !hops[0].prop) continue
    let key = `${hops[0].comp}.${hops[0].prop}`
    if (derived[key]?.values?.includes(c.value.raw)) out.set(key, c.value.raw)
  }
  return out
}

let kept = new WeakMap<Derived, Map<string, Derived>>()

/**
 * `derived` with every computed property `query`'s filter pins to one value
 * read as that value, for filling in the rows the query selected; `derived`
 * itself when it pins none. The same object for the same pins, so a gather's
 * projection cache keeps hitting.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { parse } from '@yaks/query'
 * import { loadVocab } from '@yaks/vocab'
 * import { col, type Expr, ladders, render } from '@yaks/sql'
 *
 * let v = loadVocab({ $defs: {
 *   job: { component: true, type: 'object',
 *     status: { failed: 'failed', default: 'pending' } },
 *   failed: { component: true, type: 'object' },
 * } })
 * let sql = (read: Expr) => {
 *   let { sql, params } = render(read)
 *   return { sql, params }
 * }
 * let read = (q: string) =>
 *   sql(pinned(parse(q), v)['job.status'].expr(col('entity', 'job')))
 * assertEquals(read('.job .job.status=failed'), { sql: '?', params: ['failed'] })
 * // A list leaves each row's value to the expression.
 * assertEquals(
 *   read('.job.status=pending,failed'),
 *   sql(ladders(v)['job.status'].expr(col('entity', 'job'))),
 * )
 * ```
 */
export let pinned = (
  query: And,
  vocab: Vocab,
  derived?: Derived,
): Derived => {
  let all = derivedOf(vocab, derived)
  let found = pins(query.clauses, vocab, all)
  if (!found.size) return derived ?? all
  let key = [...found].sort().join('\n')
  let byPins = kept.get(all)
  if (!byPins) kept.set(all, byPins = new Map())
  let got = byPins.get(key)
  if (!got) {
    got = { ...all }
    for (let [prop, value] of found) {
      let { select: _s, test: _t, text: _x, ...read } = all[prop]
      got[prop] = {
        ...read,
        stable: true,
        whole: true,
        deps: [],
        expr: () => val(value),
      }
    }
    byPins.set(key, alike(all, got))
  }
  return got
}
