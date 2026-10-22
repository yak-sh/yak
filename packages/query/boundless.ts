// A query that names nothing its rows have and sets no bound: only absences
// (`!p`), wishes (`?p`) and how to shape the answer. It matches nearly every
// entity in the graph, which no index narrows and no client can hold, so a
// door that answers people can refuse it before reading anything.
import type { Clause, Query } from './ast.ts'

// What leaves the rows unnarrowed: an absence (`!p`, a `p` equal to nothing),
// a wish (`?p`), and directives that order or project the answer.
let open = (c: Clause): boolean =>
  c.kind == 'order' || c.kind == 'fields' || c.kind == 'distinct' ||
  c.kind == 'pred' && !c.where && !c.not && (
      c.op == '?' ||
      c.op == '=' && c.value?.kind == 'scalar' && c.value.raw == ''
    )

/** Whether a query asks for nearly the whole graph.
 *
 * ```ts
 * import { boundless } from './boundless.ts'
 * import { parse } from './parse.ts'
 * import { equal } from '@yaks/testing'
 *
 * let is = (q: string) => boundless(parse(q))
 * equal(is('!memory.scope'), true)
 * equal(is('.order=-created ?doc'), true)
 * equal(is('.memory !memory.scope'), false)
 * equal(is('!task .limit=5'), false)
 * equal(is('!task .count'), false)
 * equal(is('milk'), false)
 * equal(is(''), false)
 * ```
 */
export let boundless = (q: Query): boolean =>
  q.clauses.length > 0 && q.clauses.every(open)
