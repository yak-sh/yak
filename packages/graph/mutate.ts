// The mutate phase: the patches go in. Everything interesting has already been
// decided — admission narrowed the batch to what this vocabulary knows,
// preconditions have held — so what is left is to hand the live bundles to the
// transaction and note what it minted.
//
// The one rule this phase owns is that DEATH IS FINAL. A deleted entity is
// tombstoned, never erased: its identity row is kept forever so the id can
// never be reused, and a patch for it — arriving late, replayed from a queue,
// or sitting later in this very batch — is void. An edit racing a delete loses
// deterministically, and nothing can bring an eid back.

import type { Bundle } from './bundle.ts'
import { comps, dead } from './bundle.ts'
import type { Tx } from './storage.ts'
import type { State } from './state.ts'
import { then } from './pipe.ts'

/**
 * The mutate phase: patch the batch's live bundles in, drop the ones aimed at
 * a dead entity, and record what died and what was born. Delete bundles stay
 * in the batch — the cascade phase is what acts on them.
 */
export let mutate = (
  bundles: Bundle[],
  tx: Tx,
  st: State,
): Bundle[] | Promise<Bundle[]> => {
  let eids = [...new Set(bundles.map((b) => b.entity.eid))]
  return then(tx.get(eids), (found) => {
    // Already in the grave before this batch began.
    let gone = new Set(
      found.filter((b) => dead(b)).map((b) => b.entity.eid),
    )
    let live: Bundle[] = []
    let kept = bundles.filter((b) => {
      let eid = b.entity.eid
      if (gone.has(eid)) return false // a tombstone takes no patch, ever
      if (dead(b)) {
        gone.add(eid)
        if (!st.killed.includes(eid)) st.killed.push(eid)
        return true
      }
      live.push(b)
      if (comps(b).length) st.touched.add(eid)
      return true
    })
    if (!live.length) return kept
    return then(tx.patch(live), (born) => {
      st.born.push(...born)
      for (let e of born) st.touched.add(e.eid)
      return kept
    })
  })
}
