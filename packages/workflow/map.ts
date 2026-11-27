// The map of a workflow: which step feeds which, computed from the steps
// themselves so it cannot drift from what runs. A step feeds another when it
// writes a component the other's match needs present, or one a reference the
// match follows points at (`result.call=$c` needs a `call`), or when the
// other's match names it by eid (`made.step=<eid>`). `requires` edges add an order the
// data does not show. Pure: steps in, edges out.

import { type Eid, match } from '@yaks/graph'
import type { Clause } from '@yaks/query'
import type { Bundle } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { writes } from './fill.ts'

/** A step as the map reads it. */
export type Mapped = {
  eid: Eid
  match: string
  write: Bundle[]
  /** steps this one waits for (its `requires` edges' ends) */
  requires?: Eid[]
}

/** One step feeding another: `data` from what they match and write,
 * `requires` from an edge. */
export type Feed = { from: Eid; to: Eid; by: 'data' | 'requires' }

// What the workflow package stamps on every row a step makes: every step
// writes them, so they say nothing about which step feeds which.
let stamped = new Set(['made', 'workflow_case'])

/** What a match needs present, by component (with what the references it
 * follows point at, given a vocabulary), and the values it compares to
 * literally (the eids it names). An absence (`!comp`), an optional read
 * (`?comp`) and either side of an `or` need nothing. */
export let needs = (
  query: string,
  vocab?: Vocab,
): { comps: string[]; names: string[] } => {
  let comps = new Set<string>()
  let names = new Set<string>()
  let path = ([comp, prop]: string[]) => {
    comps.add(comp)
    let ref = prop && vocab?.comp(comp) ? vocab.prop(comp, prop)?.ref : null
    if (ref && ref != 'entity') comps.add(ref)
  }
  let walk = (c: Clause) => {
    if (c.kind == 'and') return c.clauses.forEach(walk)
    if (c.kind != 'pred' || c.op == '?' || c.not) return
    let absent = c.op == '=' && c.value?.kind == 'scalar' && c.value.raw == ''
    if (absent) return
    path(c.path)
    if (c.value?.kind == 'scalar') names.add(c.value.raw)
  }
  for (let p of match(query).patterns) {
    walk(p.filter)
    for (let b of p.binds) path(b.path)
  }
  return { comps: [...comps], names: [...names] }
}

/**
 * Which step feeds which, in the order the steps are given; `vocab` lets a
 * reference a match follows say what it needs.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { loadVocab } from '@yaks/vocab'
 * import { callDoc } from '@yaks/tools/vocab'
 * import { feeds } from '@yaks/workflow'
 *
 * let ask = { eid: 'ask', match: '$o .order', write: [{ entity: { eid: '$c' }, call: {} }] }
 * let ship = { eid: 'ship', match: '$r .result, result.call=$c', write: [] }
 * let bill = { eid: 'bill', match: '$s .shipped', write: [], requires: ['ship'] }
 * equal(feeds([ask, ship, bill], loadVocab([callDoc])), [
 *   { from: 'ask', to: 'ship', by: 'data' },
 *   { from: 'ship', to: 'bill', by: 'requires' },
 * ])
 * ```
 */
export let feeds = (steps: Mapped[], vocab?: Vocab): Feed[] => {
  let out: Feed[] = []
  let made = steps.map((s) => writes(s.write).filter((c) => !stamped.has(c)))
  for (let to of steps) {
    let need = needs(to.match, vocab)
    steps.forEach((from, i) => {
      if (from.eid == to.eid) return
      let fed = made[i].some((c) => need.comps.includes(c)) ||
        need.names.includes(from.eid)
      if (fed) out.push({ from: from.eid, to: to.eid, by: 'data' })
    })
    for (let from of to.requires ?? []) {
      if (!out.some((f) => f.from == from && f.to == to.eid)) {
        out.push({ from, to: to.eid, by: 'requires' })
      }
    }
  }
  return out
}
