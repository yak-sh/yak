// Wire durability is deliberately separate from Vault: local drafts load
// unconditionally, but server snapshots need an authoritative epoch and a bound.
import type { Eid } from '@yaks/graph'
import { answerCache, type SavedAnswer } from './answers.ts'
import type { Saved } from './vault.ts'

/** A bounded server-tier checkpoint. load validates the epoch atomically and
 * clears ONLY this tier on mismatch. save/drop are conditional on that epoch,
 * so a late write from an obsolete tab cannot revive the previous server. */
export type WireVault = {
  /** Optional bounded semantic checkpoint. Must use the same epoch guard as rows.
   * loadAnswers never validates/changes the epoch itself. */
  loadAnswers?: (epoch: string, bytes: number) => Promise<SavedAnswer[]>
  saveAnswers?: (
    epoch: string,
    answers: SavedAnswer[],
    bytes: number,
  ) => Promise<void>
  load: (epoch: string, limit: number) => Promise<Saved[]>
  save: (epoch: string, rows: Saved[], limit: number) => Promise<void>
  drop: (epoch: string, eids: Eid[]) => Promise<void>
}

/** In-memory equivalent of wireIdb, useful to hosts without IndexedDB. */
export let wireStash = (): WireVault => {
  let epoch: string | undefined
  let answers: SavedAnswer[] = []
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
    loadAnswers: (expected, bytes) => {
      let bounded = answerCache(bytes)
      if (epoch === expected) {
        for (let answer of answers) {
          bounded.put(answer)
        }
      }
      return Promise.resolve(bounded.values())
    },
    saveAnswers: (expected, saved, bytes) => {
      let bounded = answerCache(bytes)
      for (let answer of saved) bounded.put(answer)
      if (epoch === expected) answers = bounded.values()
      return Promise.resolve()
    },
    load: (next, limit) => {
      check(limit)
      if (epoch !== next) {
        rows.clear()
        answers = []
      }
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
