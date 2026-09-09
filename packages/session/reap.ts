// Boot reconciliation: the locks whose holder is gone.
//
// A session that lets go of what it holds releases its claims; a session whose
// ENTITY is deleted takes its locks with it (`death: 'release'` in the
// vocabulary). What neither covers is a lock naming a session the graph has no
// entity for at all — a holder that was never committed, or was removed on
// another store — so the graph says somebody is working on a document that
// nobody is working on. Nothing expires on its own (a lease with a timeout
// would have to be renewed, and a worker that is merely thinking hard would
// lose its lock mid-edit), so the correction happens at the one moment there is
// a fresh, honest answer available: start-up.
//
// A session that is merely over — its transcript settled — still holds what it
// holds. Letting go is the rewind's business (D-35040), not a sweep's.
//
// The universe read here is exactly the locks and the sessions holding them,
// never the whole graph: locks are few by nature, since only live work holds
// one. It is idempotent by construction — a freed lock is gone, so the next
// start-up finds nothing to do.

import type { Bundle, Comp, Eid, Storage, Tx } from '@yaks/graph'
import { detached, then, TOMBSTONE } from '@yaks/graph'
import { CLAIM, SESSION } from './comp.ts'

/**
 * The releases a graph needs: one `claim: null` bundle per lock whose holder
 * is not a session in this graph. Reads only — hand the result to `apply()` if
 * you want the release journaled and its effects fired.
 */
export let staleLeases = (tx: Tx): Bundle[] | Promise<Bundle[]> =>
  then(tx.read(`.${CLAIM}.session!`), (locked) => {
    if (!locked.length) return []
    let holder = (b: Bundle) => String((b[CLAIM] as Comp).session)
    let runs = [...new Set(locked.map(holder))]
    return then(tx.get(runs), (found) => {
      let live = new Set<Eid>(
        found.filter((b) => b[TOMBSTONE] == null && b[SESSION] != null)
          .map((b) => b.entity.eid),
      )
      return locked.filter((b) => !live.has(holder(b)))
        .map((b): Bundle => ({ entity: b.entity, [CLAIM]: null }))
    })
  })

/**
 * Free every lock whose holder is gone, and answer with what was freed. Call
 * it once at start-up, before serving:
 *
 * ```ts
 * import { reapLeases } from '@yaks/session'
 * // let freed = reapLeases(storage)
 * ```
 *
 * The releases are written straight through storage, each its own unit of
 * work, so a reap of fifty stale locks is not one transaction that must all
 * land. A caller who wants them journaled instead can apply
 * {@link staleLeases} through a graph.
 */
export let reapLeases = (storage: Storage): Bundle[] | Promise<Bundle[]> => {
  let tx = detached(storage)
  return then(
    staleLeases(tx),
    (freed) => freed.length ? then(tx.patch(freed), () => freed) : freed,
  )
}
