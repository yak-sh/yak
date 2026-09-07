// A query read as a RULE: the part an evaluator can answer, and the parts only
// a rule engine can act on. The sigils say both things at once — `.entity,
// +!created` is a filter (an entity with no `created`) AND an instruction (add
// `created` before running, so this fires once) — so something has to separate
// them, and that separation is grammar, not engine: it belongs here, where the
// spelling is defined, rather than in every engine that reads one.
//
// `filter` is what @yaks/match or @yaks/sql is handed: the gate lowered to the
// absence it means, and every word that is an instruction dropped. The rest is
// lists of component names, in the order they were written.

import { type And, type Clause, present, type Query } from './ast.ts'

/** What a query declares when it is read as a rule. */
export type Declares = {
  /** the query an evaluator answers: the clauses that filter, with each gate
   * lowered to the absence it requires */
  filter: And
  /** `+comp` — components to add before the rule runs */
  ensures: string[]
  /** `+!comp` — components that must be ABSENT and are added before the rule
   * runs, so it fires once */
  gates: string[]
  /** `*comp` — the components the rule writes: its write set. A write is about
   * something, so the sigil says the component is PRESENT as well; `+comp` or
   * `+!comp` beside it is how a rule writes one that is not there yet. */
  writes: string[]
  /** `#comp` — the singleton resources it reads */
  resources: string[]
  /** `$name` — the variables it binds */
  vars: string[]
}

/**
 * Read a rule off a query.
 *
 * ```ts
 * import { declared, parse } from '@yaks/query'
 *
 * let r = declared(parse('.entity, +!created, *created'))
 * r.gates // ['created']
 * r.writes // ['created']
 * r.filter // and(present('entity'), absent('created'))
 *
 * // `*comp` carries its own presence: `*trashed` needs no `trashed` beside it
 * declared(parse('*trashed, trashed.at=')).filter
 * // and(absent('trashed.at'), present('trashed'))
 * ```
 */
export let declared = (ast: Query): Declares => {
  let out: Declares = {
    filter: { kind: 'and', clauses: [] },
    ensures: [],
    gates: [],
    writes: [],
    resources: [],
    vars: [],
  }
  let take = (c: Clause) => {
    if (c.kind == 'ensure') return void out.ensures.push(c.comp)
    if (c.kind == 'gate') {
      out.gates.push(c.comp)
      // The gate's filter half: it fires only where the component is absent.
      return void out.filter.clauses.push({
        kind: 'pred',
        path: c.comp.split('.'),
        op: '=',
        value: { kind: 'scalar', raw: '' },
      })
    }
    if (c.kind == 'mutable') return void out.writes.push(c.comp)
    if (c.kind == 'resource') return void out.resources.push(c.comp)
    if (c.kind == 'var') return void out.vars.push(c.name)
    out.filter.clauses.push(c)
  }
  for (let c of ast.clauses) take(c)
  // The mutable sigil's filter half: a rule writes what it MATCHED, so `*comp`
  // says the component is present too — the presence clause beside it was only
  // ever a second spelling of the same word. An ensure or a gate has already
  // said how a component the rule writes gets there, so it needs none.
  for (let c of out.writes) {
    if (!out.ensures.includes(c) && !out.gates.includes(c)) {
      out.filter.clauses.push(present(c))
    }
  }
  return out
}
