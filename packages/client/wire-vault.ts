// Where the server-synchronized rows are stored, deliberately separate from
// the Vault: this browser's own drafts are loaded unconditionally, while rows
// that came from the server are only loaded for the epoch the server named,
// and only up to a row limit.
import type { Eid } from '@yaks/graph'
import { answerCache, type SavedAnswer } from './answers.ts'
import type { Saved } from './vault.ts'

/** A bounded store of server-synchronized rows. `load` checks the epoch
 * atomically and, on a mismatch, clears only these rows — never the vault.
 * `save` and `drop` are conditional on that same epoch, so a late write from a
 * tab still on the previous epoch cannot bring its rows back. */
export type WireVault = {
  /** Optionally, the saved query results: ids and coverage, bounded by a byte
   * budget. They are guarded by the same epoch as the rows, and `loadAnswers`
   * never checks or changes the epoch itself. */
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

/** The in-memory equivalent of {@link wireIdb}, for an application with no
 * IndexedDB. */
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
