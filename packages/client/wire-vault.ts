// Where the server-synchronized rows are stored, deliberately separate from
// the Vault: this browser's own drafts are loaded unconditionally, while rows
// that came from the server are only loaded for the epoch the server named,
// and only up to a row limit.
import type { Bundle, Eid } from '@yaks/graph'
import { answerCache, type SavedAnswer } from './answers.ts'
import type { Saved } from './vault.ts'

/** A bounded store of server-synchronized rows. `load` checks the epoch
 * atomically and, on a mismatch, clears only these rows — never the vault.
 * `save` and `drop` are conditional on that same epoch, so a late write from a
 * tab still on the previous epoch cannot bring its rows back. */
export type WireVault = {
  /** Read one kept row without loading the working set or claiming its epoch. */
  peek: (epoch: string, eid: Eid) => Promise<Saved | undefined>
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
  /** Check the epoch as `load` does, clearing what another kept, without
   * reading the rows. */
  claim: (epoch: string) => Promise<void>
  save: (epoch: string, rows: Saved[], limit: number) => Promise<void>
  drop: (epoch: string, eids: Eid[]) => Promise<void>
}

/** The in-memory equivalent of {@link wireIdb}, for an application with no
 * IndexedDB. It can start holding `start.rows` under `start.epoch`: what a
 * page drawn by its server read, which a client given that epoch shows until
 * its subscriptions answer. */
export let wireStash = (
  start?: { epoch: string; rows: Bundle[] },
): WireVault => {
  let epoch = start?.epoch
  let answers: SavedAnswer[] = []
  let rows = new Map<Eid, Saved>(
    (start?.rows ?? []).map(({ entity: { eid, num, prefix }, ...comps }) => [
      eid,
      { eid, num, prefix, comps: comps as Saved['comps'] },
    ]),
  )
  let check = (limit: number) => {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error('invalid retention limit')
    }
  }
  let claim = (next: string) => {
    if (epoch !== next) {
      rows.clear()
      answers = []
    }
    epoch = next
  }
  let prune = (limit: number) => {
    while (rows.size > limit) rows.delete(rows.keys().next().value!)
  }
  return {
    peek: (expected, eid) =>
      Promise.resolve(epoch === expected ? rows.get(eid) : undefined),
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
      claim(next)
      prune(limit)
      return Promise.resolve([...rows.values()])
    },
    claim: (next) => Promise.resolve(claim(next)),
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

/** The wire vault of a page its server drew from `rows`: it loads those
 * rows alone, and no answers, since what the page shows is newer than
 * anything `vault` kept and must not be drawn over by it, and keeps them in
 * `vault`, with everything the page goes on to hold. A page drawn without
 * its server (an app's shell, offline) loads `vault` itself. A vault that
 * cannot be written (a browser refusing its storage) keeps nothing; the
 * page still holds what it was drawn from.
 *
 * ```ts
 * import { wireDrawn, wireStash } from '@yaks/client'
 * import { equal } from '@yaks/testing'
 * let kept = wireStash({ epoch: 'e', rows: [
 *   { entity: { eid: 'old' }, doc: { title: 'Kept' } },
 *   { entity: { eid: 'card' }, doc: { title: 'Before' } },
 * ] })
 * let page = wireDrawn(kept, [{ entity: { eid: 'card' }, doc: { title: 'Now' } }])
 * equal((await page.load('e', 10)).map((r) => [r.eid, r.comps.doc]), [
 *   ['card', { title: 'Now' }],
 * ])
 * equal((await kept.load('e', 10)).map((r) => [r.eid, r.comps.doc]), [
 *   ['old', { title: 'Kept' }],
 *   ['card', { title: 'Now' }],
 * ])
 * ```
 */
export let wireDrawn = (vault: WireVault, rows: Bundle[]): WireVault => {
  let drawn = rows.map(({ entity: { eid, num, prefix }, ...comps }) => ({
    eid,
    num,
    prefix,
    comps: comps as Saved['comps'],
  }))
  return {
    ...vault,
    loadAnswers: () => Promise.resolve([]),
    load: async (epoch, limit) => {
      await vault.claim(epoch).catch(() => {})
      await vault.save(epoch, drawn, limit).catch(() => {})
      return drawn.slice(Math.max(0, drawn.length - limit))
    },
  }
}
