// A query read as a rule: the part an evaluator can answer, and the parts only
// a rule engine can act on. The prefix characters mean both at once — `.entity,
// +!created` is a filter (an entity with no `created`) and an instruction (add
// `created` before running, so the rule runs once) — so something has to
// separate the two, and that separation belongs here, where the format is
// defined, rather than in every engine that reads a rule.
//
// `filter` is what @yaks/match or @yaks/sql is given: the gate reduced to the
// absence it requires, with every clause that is an instruction removed. The
// rest is lists of component names, in the order they were written.

import {
  type And,
  type Clause,
  present,
  type Query,
  type Value,
} from './ast.ts'

/** One property a rule writes: the component, the property, and the value as
 * written (a literal, or a `$name` the compiler reads as a variable).
 * `mutable` records which prefix it came from — `*` writes into a component
 * that has to be there already, `+` into one the rule adds. */
export type Set = {
  comp: string
  prop: string
  value: Value
  mutable?: boolean
}

/** What a query declares when it is read as a rule. */
export type Declares = {
  /** the query an evaluator answers: the clauses that filter, with each gate
   * lowered to the absence it requires */
  filter: And
  /** `+comp` — components to add before the rule runs */
  ensures: string[]
  /** `+!comp` — components that must be absent and are added before the rule
   * runs, so it fires once */
  gates: string[]
  /** `*comp` — the components the rule writes: its write set. A write is about
   * something that exists, so this also asserts the component is present;
   * `+comp` or `+!comp` beside it is how a rule writes one that is not there
   * yet. */
  writes: string[]
  /** `#comp` — the singleton resources it reads */
  resources: string[]
  /** `$name` — the variables it names */
  vars: string[]
  /** `$name=value` — the variables it binds, which is what a template
   * invocation's arguments are */
  values: [string, Value][]
  /** `+comp.prop=value` / `*comp.prop=value` — the properties it writes */
  sets: Set[]
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
    values: [],
    sets: [],
  }
  let once = (list: string[], comp: string) => {
    if (!list.includes(comp)) list.push(comp)
  }
  let take = (c: Clause) => {
    if (c.kind == 'ensure') {
      if (c.prop) {
        out.sets.push({ comp: c.comp, prop: c.prop, value: c.value! })
      }
      return void once(out.ensures, c.comp)
    }
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
    if (c.kind == 'mutable') {
      if (c.prop) {
        out.sets.push({
          comp: c.comp,
          prop: c.prop,
          value: c.value!,
          mutable: true,
        })
      }
      return void once(out.writes, c.comp)
    }
    if (c.kind == 'resource') return void out.resources.push(c.comp)
    if (c.kind == 'var') {
      return void (c.value
        ? out.values.push([c.name, c.value])
        : out.vars.push(c.name))
    }
    out.filter.clauses.push(c)
  }
  for (let c of ast.clauses) take(c)
  // The filter half of `*comp`: a rule writes what it matched, so `*comp`
  // asserts the component is present too — a presence clause written beside it
  // was only ever a second way of saying the same thing. An ensure or a gate
  // already states how a component the rule writes gets there, so neither
  // needs one.
  for (let c of out.writes) {
    if (!out.ensures.includes(c) && !out.gates.includes(c)) {
      out.filter.clauses.push(present(c))
    }
  }
  return out
}
