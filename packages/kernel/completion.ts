// Who finished a piece of work, kept on the `completed` mark across later
// edits.
//
// The hook runs in the `precondition` phase, before @yaks/graph fills in the
// mark's `{at, by, via}`. For every bundle that writes `completed`, it reads
// the row already stored: if that row had a `completed` component, its `by` is
// carried over, so a later patch of the same mark cannot change who finished
// the work. If there was no such component, `by` is the one on the incoming
// component, or the `$actor.by` the `apply()` call carries, or null.

import { after } from '@yaks/fp'
import { type Comp, type Hook } from '@yaks/graph'

export let completing: Hook = (bundles, tx) => {
  let writes = bundles.filter((b) => b.completed != null)
  if (!writes.length) return bundles
  let actor = bundles.find((b) => b.$actor)?.$actor?.by
  return after(tx.get(writes.map((b) => b.entity.eid)), (rows) => {
    let previous = new Map(rows.map((b) => [b.entity.eid, b.completed as Comp]))
    for (let b of writes) {
      let old = previous.get(b.entity.eid)
      b.completed = {
        ...(b.completed as Comp),
        by: old ? old.by ?? null : (b.completed as Comp).by ?? actor ?? null,
      }
    }
    return bundles
  })
}
