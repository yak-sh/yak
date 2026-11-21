// What a writer drops: entities that are only its own bookkeeping, such as a
// finished effect's run (@yaks/effects pool.ts), removed through storage
// alone (`Graph.drop`). Nothing refers to such a row and nothing derives from
// it, so none of `apply()`'s phases has anything to say about its removal,
// and through them it cost more than many a run. No person restores one, so
// storage keeps no recoverable copy of it (`Tx.discard`): kept, each run cost
// a store a trash row for good.

import { after } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
import { type Bundle, dead, type Eid } from './bundle.ts'
import { Refused } from './errors.ts'
import { preconditions } from './guard.ts'
import type { Storage } from './storage.ts'

/** Remove these entities in one storage transaction, each named with its
 * `$was` and only where it still holds what that says (./guard.ts): a
 * changed one throws `Stale` and removes nothing. → the eids removed;
 * one already gone is not. */
export let drop = (
  storage: Pick<Storage, 'tx'>,
  vocab: Vocab,
  bundles: Bundle[],
): Eid[] | Promise<Eid[]> => {
  for (let b of bundles) {
    if (Object.keys(b).some((k) => k != 'entity' && k != '$was')) {
      throw new Refused('drop takes an entity and its $was, nothing else')
    }
  }
  let eids = [...new Set(bundles.map((b) => b.entity.eid))]
  if (!eids.length) return []
  // What the guards read, and no more.
  let read = [...new Set(bundles.flatMap((b) => Object.keys(b.$was ?? {})))]
    .filter((c) => vocab.comp(c))
  return storage.tx((tx) =>
    after(tx.get(eids, read), (found) => {
      preconditions(bundles, found, vocab)
      let standing = found.filter((b) => !dead(b)).map((b) => b.entity)
      return after(
        standing.length
          ? tx.discard ? tx.discard(standing) : tx.remove(standing)
          : undefined,
        () => standing.map((e) => e.eid),
      )
    })
  )
}
