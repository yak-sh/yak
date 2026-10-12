// Malformed identity rows can be left behind by an older writer. They are not
// entities to tombstone forever: once they hold nothing and nothing points at
// them, an explicit repair request removes their identity itself. Ordinary
// deletion keeps its identity, and generated identities are never pruned.

import { after } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
import { type Bundle, comps, tombstoned } from './bundle.ts'
import { Refused } from './errors.ts'
import { about } from './gather.ts'
import { minted } from './mint.ts'
import type { Tx } from './storage.ts'

/** Refuse a prune request that also writes data or names a generated id. */
export let prunable = (b: Bundle): void => {
  if (b.$prune === undefined) return
  if (
    b.$prune !== true || minted(b.entity.eid) || comps(b).length ||
    Object.keys(b.entity).some((k) => k != 'eid') ||
    Object.keys(b).some((k) =>
      k != 'entity' && k != '$prune' && k != '$actor' && k != '$was'
    )
  ) {
    throw new Refused('$prune removes only an exact malformed orphan identity')
  }
}

/** Finish explicit orphan repairs after all transaction hooks have written.
 * The checks see the final rows: no component or reference is discarded to
 * make a target orphaned. Missing targets are already repaired. */
export let prune = (
  bundles: Bundle[],
  tx: Tx,
  vocab: Vocab,
): Bundle[] | Promise<Bundle[]> => {
  let requests = bundles.filter((b) => b.$prune !== undefined)
  if (!requests.length) return bundles
  for (let b of requests) prunable(b)
  if (!tx.prune) {
    throw new Refused('this storage cannot prune orphan identities')
  }
  let eids = [...new Set(requests.map((b) => b.entity.eid))]
  return after(tx.get(eids), (found) => {
    for (let b of found) {
      if (comps(b).length) {
        throw new Refused(
          `cannot prune ${JSON.stringify(b.entity.eid)}: it holds components`,
        )
      }
    }
    return after(about(tx, vocab, eids), (owners) => {
      if (owners.length) {
        throw new Refused(
          `cannot prune orphan identities: referenced by ${
            owners.map((b) => b.entity.eid).join(', ')
          }`,
        )
      }
      return after(tx.prune!(found.map((b) => b.entity.eid)), () => [
        ...bundles.filter((b) => b.$prune === undefined),
        ...found.map((b) => tombstoned(b.entity)),
      ])
    })
  })
}
