// What a writer books: entities that are only its own bookkeeping, such as an
// effect's run (@yaks/effects pool.ts), written through storage alone
// (`Graph.book`). Nothing refers to such a row and nothing derives from it, so
// none of `apply()`'s phases has anything to say about it, and through them a
// run's claim was stamped `created` and moved to another archetype, rows its
// removal then wrote again. No person restores one, so a removal keeps no
// recoverable copy and leaves no tombstone (`Tx.discard`).

import { after } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
import { type Bundle, comps, dead, type Eid } from './bundle.ts'
import { Refused } from './errors.ts'
import { preconditions } from './guard.ts'
import type { Storage } from './storage.ts'

/** Write these entities in one storage transaction, each named with its
 * `$was` and only where it still holds what that says (./guard.ts): a bundle
 * with `$delete` is erased, any other patched. A changed one throws `Stale`
 * and writes nothing. → the eids written; one already gone is not. */
export let book = (
  storage: Pick<Storage, 'tx'>,
  vocab: Vocab,
  bundles: Bundle[],
): Eid[] | Promise<Eid[]> => {
  for (let b of bundles) {
    for (let k of Object.keys(b)) {
      if (k == 'entity' || k == '$was' || k == '$delete') continue
      if (k.startsWith('$') || !vocab.comp(k)) {
        throw new Refused(`book writes declared components, not ${k}`)
      }
    }
  }
  let eids = [...new Set(bundles.map((b) => b.entity.eid))]
  if (!eids.length) return []
  // What the guards read, and no more.
  let read = [...new Set(bundles.flatMap((b) => Object.keys(b.$was ?? {})))]
    .filter((c) => vocab.comp(c))
  return storage.tx((tx) =>
    after(tx.get(eids, read), (found) => {
      let standing = new Set(
        found.filter((b) => !dead(b)).map((b) => b.entity.eid),
      )
      let here = bundles.filter((b) => standing.has(b.entity.eid))
      preconditions(here, found, vocab)
      let gone = here.filter(dead).map((b) => b.entity)
      let patched = here.filter((b) => !dead(b) && comps(b).length)
        .map((b) => ({ entity: b.entity, ...Object.fromEntries(comps(b)) }))
      return after(
        patched.length ? tx.patch(patched) : undefined,
        () =>
          after(
            gone.length
              ? tx.discard ? tx.discard(gone) : tx.remove(gone)
              : undefined,
            () => [
              ...new Set([...patched, ...gone.map((entity) => ({ entity }))]
                .map((b) => b.entity.eid)),
            ],
          ),
      )
    })
  )
}
