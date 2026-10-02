// A structural walk shared by query interpreters. The mapper sees children
// before their parent; unchanged subtrees keep their identity.
import type { Clause } from './ast.ts'

/** Map every clause, including boolean groups and reverse-association tests. */
export let map = <C extends Clause>(clause: C, f: (c: Clause) => Clause): C => {
  let next: Clause = clause
  if (clause.kind == 'and' || clause.kind == 'or') {
    let clauses = clause.clauses.map((c) => map(c, f))
    if (clauses.some((c, i) => c !== clause.clauses[i])) {
      next = { ...clause, clauses }
    }
  } else if (clause.kind == 'pred' && clause.where) {
    let where = map(clause.where, f)
    if (where !== clause.where) next = { ...clause, where }
  }
  return f(next) as C
}
