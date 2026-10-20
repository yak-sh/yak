// Finite scalar alternatives, for limiting complete conjunctions before their
// union. A disjunction is split only where each of its alternatives names a
// test an index can seek; one that cannot stays whole in every arm, a test of
// the rows the arm's seek finds, since an arm per alternative would seek the
// same rows again. Wider or richer predicates keep the ordinary query
// compiler's plan.
import type { Clause, Pred } from '@yaks/query/core'

export let alternatives = (
  cs: Clause[],
  seeks: (p: Pred) => boolean = () => true,
  cap = 32,
): Clause[][] | undefined => {
  let out: Clause[][] = [[]]
  for (let c of cs) {
    let next = scalar(c) && c.kind == 'pred'
      ? [[c]]
      : c.kind == 'or' && scalar(c) && !c.clauses.every(narrows(seeks))
      ? [[c]]
      : c.kind == 'or'
      ? c.clauses.flatMap((x) => alternatives([x], seeks, cap) ?? [undefined])
      : c.kind == 'and'
      ? alternatives(c.clauses, seeks, cap)
      : undefined
    if (!next || next.some((x) => !x) || out.length * next.length > cap) return
    out = out.flatMap((a) => next.flatMap((b) => b ? [[...a, ...b]] : []))
  }
  return out
}

// Whether a clause is made of positive predicates alone.
let scalar = (c: Clause): boolean =>
  c.kind == 'pred'
    ? !c.not && !c.where
    : (c.kind == 'and' || c.kind == 'or') && c.clauses.every(scalar)

// Whether an alternative is sure to name a seekable test.
let narrows = (seeks: (p: Pred) => boolean) => (c: Clause): boolean =>
  c.kind == 'pred'
    ? seeks(c)
    : c.kind == 'and'
    ? c.clauses.some(narrows(seeks))
    : c.kind == 'or' && c.clauses.every(narrows(seeks))
