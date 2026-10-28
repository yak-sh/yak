// A structural walk shared by query interpreters. The mapper sees children
// before their parent; unchanged subtrees keep their identity.
import type { Clause } from './ast.ts'

/** Map every clause, including boolean groups and reverse-association tests. */
export let map = <C extends Clause>(clause: C, f: (c: Clause) => Clause): C => {
  let next: Clause = clause
  if (clause.kind == 'and' || clause.kind == 'or') {
    let clauses: Clause[] | undefined
    for (let i = 0; i < clause.clauses.length; i++) {
      let was = clause.clauses[i]
      let c = map(was, f)
      if (c !== was) clauses ??= clause.clauses.slice(0, i)
      clauses?.push(c)
    }
    if (clauses) next = { ...clause, clauses }
  } else if (clause.kind == 'pred' && clause.where) {
    let where = map(clause.where, f)
    if (where !== clause.where) next = { ...clause, where }
  }
  return f(next) as C
}

/** The words a query searches for among the rows it selects: its text
 * clauses, alone or in groups, and not a reverse-association test's, whose
 * words are about other entities.
 *
 * ```ts
 * import { parse, words } from '@yaks/query'
 * import { equal } from '@yaks/testing'
 *
 * equal(words(parse('moss "the vale" (.task | crash)')), [
 *   'moss',
 *   'the vale',
 *   'crash',
 * ])
 * equal(words(parse('.task .limit=5')), [])
 * ```
 */
export let words = (clause: Clause): string[] =>
  clause.kind == 'text'
    ? [clause.value]
    : clause.kind == 'and' || clause.kind == 'or'
    ? clause.clauses.flatMap(words)
    : []
