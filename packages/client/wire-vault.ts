// Wire durability is deliberately separate from Vault: local drafts load
// unconditionally, but server snapshots need an authoritative epoch and a bound.
import type { Eid } from '@yaks/graph'
import type { Saved } from './vault.ts'

/** A bounded server-tier checkpoint. load validates the epoch atomically and
 * clears ONLY this tier on mismatch. save/drop are conditional on that epoch,
 * so a late write from an obsolete tab cannot revive the previous server. */
export type WireVault = {
  load: (epoch: string, limit: number) => Promise<Saved[]>
  save: (epoch: string, rows: Saved[], limit: number) => Promise<void>
  drop: (epoch: string, eids: Eid[]) => Promise<void>
}

/** In-memory equivalent of wireIdb, useful to hosts without IndexedDB. */
export let wireStash = (): WireVault => {
  let epoch: string | undefined
  let rows = new Map<Eid, Saved>()
  let check = (limit: number) => {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error('invalid retention limit')
    }
  }
  let prune = (limit: number) => {
    while (rows.size > limit) rows.delete(rows.keys().next().value!)
  }
  return {
    load: (next, limit) => {
      check(limit)
      if (epoch !== next) rows.clear()
      epoch = next
      prune(limit)
      return Promise.resolve([...rows.values()])
    },
    save: (expected, saved, limit) => {
      check(limit)
      if (epoch === expected) {
        for (let r of saved) {
          rows.delete(r.eid)
          rows.set(r.eid, r)
        }
        prune(limit)
      }
      return Promise.resolve()
    },
    drop: (expected, eids) => {
      if (epoch === expected) { for (let eid of eids) rows.delete(eid) }
      return Promise.resolve()
    },
  }
}
