/** Keep the completion author on its mark, including across later edits. */
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
