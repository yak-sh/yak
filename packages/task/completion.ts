// Who completed a task, kept on the `completed` component across later edits.
//
// The hook runs in the `precondition` phase, before @yaks/graph fills in the
// mark's `{at, by, via}`. For every bundle that writes `completed`, it reads
// the row already stored: if that row had a `completed` component, its `by` is
// carried over, so a later patch of the same mark cannot change who finished
// the task. If there was no such component, `by` is the one on the incoming
// component, or the `$actor.by` the `apply()` call carries, or null.

import { type Comp, type Hook, then } from '@yaks/graph'

export let completing: Hook = (bundles, tx) => {
  let writes = bundles.filter((b) => b.completed != null)
  if (!writes.length) return bundles
  let actor = bundles.find((b) => b.$actor)?.$actor?.by
  return then(tx.get(writes.map((b) => b.entity.eid)), (rows) => {
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
