// Who finished a piece of work, kept on the `completed` mark across later
// edits.
//
// The hook runs in the `precondition` phase, before @yaks/graph fills in the
// mark's `{at, by, via}`. For every bundle that writes `completed`, `by` is
// the one the incoming component names, which only trusted server code can
// (the wire refuses a stamped property), as a repair or a restore does. A
// write naming none reads the row already stored: if that row had a
// `completed` component, its `by` is carried over, so a later patch of the
// same mark cannot change who finished the work; otherwise `by` is the
// `$actor.by` the `apply()` call carries, or null.

import { after } from '@yaks/fp'
import type { Comp } from '@yaks/graph/bundle'
import type { Hook } from '@yaks/graph/plugin'

export let completing: Hook = (bundles, tx) => {
  let writes = bundles.filter((b) => b.completed != null)
  if (!writes.length) return bundles
  let actor = bundles.find((b) => b.$actor)?.$actor?.by
  return after(tx.get(writes.map((b) => b.entity.eid)), (rows) => {
    let previous = new Map(rows.map((b) => [b.entity.eid, b.completed as Comp]))
    for (let b of writes) {
      let old = previous.get(b.entity.eid)
      let named = (b.completed as Comp).by
      b.completed = {
        ...(b.completed as Comp),
        by: named !== undefined ? named : old ? old.by ?? null : actor ?? null,
      }
    }
    return bundles
  })
}
