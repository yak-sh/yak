// An identity is erased, not tombstoned, in two cases, both asked for with
// `$prune` and both only once it holds nothing and nothing points at it. A
// malformed identity row an older writer left behind is repaired away. A
// tombstone whose delete is long past is collected: it exists to swallow a
// write that raced the delete (./mutate.ts), and a retention sweep
// (@yaks/effects `expire`) prunes it once no such write can still arrive. A
// generated identity is pruned only from its tombstone, and only by trusted
// server code, so ordinary deletion keeps its identity.

import { after } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
import { type Bundle, comps, dead, tombstoned } from './bundle.ts'
import { Refused } from './errors.ts'
import { about } from './gather.ts'
import { minted } from './mint.ts'
import type { Tx } from './storage.ts'

/** Refuse a prune request that also writes data. */
export let prunable = (b: Bundle): void => {
  if (b.$prune === undefined) return
  if (
    b.$prune !== true || comps(b).length ||
    Object.keys(b.entity).some((k) => k != 'eid') ||
    Object.keys(b).some((k) =>
      k != 'entity' && k != '$prune' && k != '$actor' && k != '$was'
    )
  ) {
    throw new Refused('$prune removes only an exact empty identity')
  }
}

/** Finish explicit prunes after all transaction hooks have written. The
 * checks see the final rows: no component or reference is discarded to make a
 * target orphaned. Missing targets are already gone. */
export let prune = (
  bundles: Bundle[],
  tx: Tx,
  vocab: Vocab,
  trusted = false,
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
      if (minted(b.entity.eid) && !(dead(b) && trusted)) {
        throw new Refused(
          `cannot prune ${
            JSON.stringify(b.entity.eid)
          }: a generated identity is pruned only from its tombstone, by trusted server code`,
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
