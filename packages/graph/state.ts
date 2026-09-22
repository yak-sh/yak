// What one run of `apply()` learns as it goes. The bundles carry the data —
// every phase takes bundles and returns bundles — but three facts are about
// the run rather than about any one bundle: which entities this change
// deleted, which it created, and which it wrote to. The stamp phase needs all
// three (a created entity gets `created`, a written one gets `updated`, a
// deleted one gets neither), so they are collected here rather than smuggled
// through the bundles.

import type { Eid, Entity } from './bundle.ts'

/** The bookkeeping one `apply()` run accumulates across its phases. */
export type State = {
  /** entities this change deleted, in the order it deleted them */
  killed: Eid[]
  /** entities storage created while applying it, with their `num` */
  born: Entity[]
  /** entities this change wrote to (a created entity counts as written to) */
  touched: Set<Eid>
}

/** A fresh run's bookkeeping. */
export let state = (): State => ({
  killed: [],
  born: [],
  touched: new Set(),
})
