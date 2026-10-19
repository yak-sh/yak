// Finite scalar alternatives, for limiting complete conjunctions before their
// union. Wider or richer predicates keep the ordinary query compiler's plan.
import type { Clause, Pred } from '@yaks/query/core'

export let alternatives = (cs: Clause[], cap = 32): Pred[][] | undefined => {
  let out: Pred[][] = [[]]
  for (let c of cs) {
    let next = c.kind == 'pred' && !c.not && !c.where
      ? [[c]]
      : c.kind == 'or'
      ? c.clauses.flatMap((x) => alternatives([x], cap) ?? [undefined])
      : c.kind == 'and'
      ? alternatives(c.clauses, cap)
      : undefined
    if (!next || next.some((x) => !x) || out.length * next.length > cap) return
    out = out.flatMap((a) => next.flatMap((b) => b ? [[...a, ...b]] : []))
  }
  return out
}
