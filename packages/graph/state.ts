// What one run of `apply()` learns as it goes. The batch itself carries the
// data — every phase takes bundles and returns bundles — but three facts are
// about the RUN rather than about any bundle: which entities this batch
// killed, which it created, and which it touched. The stamp phase needs all
// three (a birth gets `created`, a touch gets `updated`, a casualty gets
// neither), so they are gathered here rather than smuggled through the wire.

import type { Eid, Entity } from './bundle.ts'

/** The bookkeeping one `apply()` run accumulates across its phases. */
export type State = {
  /** entities this batch deleted, in the order it deleted them */
  killed: Eid[]
  /** entities storage minted while applying it, with their `num` */
  born: Entity[]
  /** entities this batch wrote to (a birth is also a touch) */
  touched: Set<Eid>
}

/** A fresh run's bookkeeping. */
export let state = (): State => ({
  killed: [],
  born: [],
  touched: new Set(),
})
