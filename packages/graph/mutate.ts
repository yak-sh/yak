// The mutate phase: the patches are written. Everything interesting has
// already been decided — admission narrowed the change to what this vocabulary
// declares, and the preconditions held — so what is left is to hand the live
// bundles to the transaction and record the ids storage assigned.
//
// The one rule this phase owns is how a write meets a tombstone. A deleted
// entity is tombstoned, never erased: its identity keeps its eid and its
// number. A write that raced the delete — one whose `$was` names a value read
// before it — is swallowed, so an edit made against a view from before the
// delete loses deterministically. Any other write clears the tombstone and
// lands: the entity is back, with its eid, its number, and exactly the
// components that write gives it. Within one change, a patch after the
// change's own delete of an entity is dropped: the change said both, and the
// delete is what the cascade acts on.

import type { Bundle } from './bundle.ts'
import { comps, dead, gives, raced } from './bundle.ts'
import type { Tx } from './storage.ts'
import type { State } from './state.ts'
import { then } from './pipe.ts'

/**
 * The mutate phase: write the change's live bundles, swallow the ones that
 * raced a delete, revive a deleted entity any other write gives a component,
 * and record which entities were deleted and which were created. Delete
 * bundles stay in the change — the cascade phase is what acts on them.
 */
export let mutate = (
  bundles: Bundle[],
  tx: Tx,
  st: State,
): Bundle[] | Promise<Bundle[]> => {
  let eids = [...new Set(bundles.map((b) => b.entity.eid))]
  return then(tx.get(eids), (found) => {
    // Deleted before this change began: a write may bring one back.
    let buried = new Set(
      found.filter((b) => dead(b)).map((b) => b.entity.eid),
    )
    // Deleted by this change: nothing later in it writes to one.
    let gone = new Set<string>()
    let live: Bundle[] = []
    let back: string[] = []
    let kept = bundles.filter((b) => {
      let eid = b.entity.eid
      if (gone.has(eid)) return false
      if (buried.has(eid)) {
        // Deleting it again is nothing, a write that raced its delete is
        // swallowed, and one that gives no component has nothing to bring
        // back. Any other write revives it.
        if (dead(b) || raced(b) || !gives(b)) return false
        buried.delete(eid)
        back.push(eid)
      }
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
    return then(
      back.length ? tx.revive(back) : undefined,
      () =>
        then(tx.patch(live), (born) => {
          st.born.push(...born)
          for (let e of born) st.touched.add(e.eid)
          return kept
        }),
    )
  })
}
