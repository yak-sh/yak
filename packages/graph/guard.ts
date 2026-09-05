// The precondition: a write that names the value it was based on. `$was`
// carries, per column, the SHA-256 of the value the caller READ (or `null` for
// "I read no value"); if the stored value has moved since, the whole batch is
// refused and the committed value is reported back, so the caller merges
// rather than clobbering a writer it never saw. It is the graph's `--ff-only`.
//
// Two details matter, and both are the difference between a guard and a
// decoration. The batch is refused WHOLE: a batch guarding two columns and
// losing one must keep neither, or you end up with a title from one writer and
// a body from another. And every column named must exist — a guard on a column
// that isn't there would read `undefined`, compare equal to "absent", and
// protect nothing, which is the failure mode wearing a safety label.

import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import type { Tx } from './storage.ts'
import { then } from './pipe.ts'
import { sha256 } from './sha256.ts'
import { Refused } from './admit.ts'

/** A refused precondition: which column moved, and what it holds now. The
 * committed value rides along so the caller can merge onto it. */
export class Stale extends Error {
  /**
   * @param eid the entity whose column moved
   * @param comp the component it lives on
   * @param column the column itself
   * @param current the value the graph holds now (`null` if it holds none)
   */
  constructor(
    public eid: Eid,
    public comp: string,
    public column: string,
    public current: unknown,
  ) {
    super(`${comp}.${column} of ${eid} has moved since it was read`)
    this.name = 'Stale'
  }
}

/** The token a caller puts in `$was`: the SHA-256 of a value read, or `null`
 * when it read no value. One function so both ends hash alike. */
export let token = (value: unknown): string | null =>
  value == null ? null : sha256(String(value))

/**
 * The precondition phase: check every `$was` the batch carries against the
 * state as the batch FOUND it, and throw {@link Stale} on the first column
 * that moved. Read through the transaction, before anything in the batch has
 * written — a guard read after the batch's own writes would refuse a value the
 * batch itself moved.
 */
export let guard = (
  bundles: Bundle[],
  tx: Tx,
  vocab: Vocab,
): Bundle[] | Promise<Bundle[]> => {
  let guarded = bundles.filter((b) => b.$was)
  if (!guarded.length) return bundles
  return then(tx.get(guarded.map((b) => b.entity.eid)), (found) => {
    let at = new Map(found.map((b) => [b.entity.eid, b]))
    for (let b of guarded) {
      let stored = at.get(b.entity.eid)
      for (let [comp, cols] of Object.entries(b.$was!)) {
        if (!vocab.comp(comp)) {
          throw new Refused(`unknown component in $was: ${comp}`)
        }
        let declared = new Set(vocab.columns(comp))
        for (let [col, want] of Object.entries(cols)) {
          if (!declared.has(col)) {
            throw new Refused(`unknown column in $was: ${comp}.${col}`)
          }
          let cur = (stored?.[comp] as Comp | undefined)?.[col] ?? null
          if (token(cur) != want) {
            throw new Stale(b.entity.eid, comp, col, cur)
          }
        }
      }
    }
    return bundles
  })
}
