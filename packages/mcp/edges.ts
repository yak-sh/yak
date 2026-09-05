// An entity's edges, read off the bundles themselves. A reference in this model
// is a COLUMN whose value is another entity's id, and the vocabulary already
// says which columns those are — so given the bundles in hand, the edges
// between them are a derivation, not a second query.
//
// That is why `graph_show` gathers the backlinks as whole bundles first: the
// incoming edges fall out of the same pass as the outgoing ones, because an
// edge INTO an entity is just a reference column on somebody else's bundle.

import type { Bundle } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'

/** One reference: a column on `from` holding the id of `to`. */
export type Edge = {
  /** the entity carrying the reference */
  from: string
  /** the entity it points at */
  to: string
  /** the component the column lives on */
  comp: string
  /** the column itself */
  prop: string
}

// The value of one column of one bundle, when the component is there.
let at = (b: Bundle, comp: string, prop: string): unknown => {
  let c = b[comp]
  return c && typeof c == 'object' ? (c as Record<string, unknown>)[prop] : null
}

/**
 * Every reference the given bundles carry, in the order the vocabulary
 * declares its reference columns.
 *
 * ```ts
 * edges(shop, [{ entity: { eid: 'r1' }, review: { book: 'b1', stars: 5 } }])
 * // → [{ from: 'r1', to: 'b1', comp: 'review', prop: 'book' }]
 * ```
 */
export let edges = (vocab: Vocab, bundles: Bundle[]): Edge[] => {
  let out: Edge[] = []
  for (let b of bundles) {
    for (let [comp, prop] of vocab.refCols()) {
      let to = at(b, comp, prop)
      if (typeof to == 'string' && to) {
        out.push({ from: b.entity.eid, to, comp, prop })
      }
    }
  }
  return out
}
