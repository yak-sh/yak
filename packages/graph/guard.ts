// The precondition: a write that states the value it was based on. `$was`
// carries, per column, the SHA-256 of the value the caller READ (or `null` for
// "I read no value"); if the stored value has changed since, the whole change
// is refused and the committed value is reported back, so the caller can merge
// onto it rather than overwriting a writer it never saw. It works like git's
// `--ff-only`.
//
// Two details matter, and both are the difference between a check that works
// and one that only looks like it does. The change is refused AS A WHOLE: a
// change guarding two columns that loses one of them must apply neither, or
// you end up with a title from one writer and a body from another. And every
// column named must be declared — a check on a column that does not exist
// would read `undefined`, compare equal to "absent", and protect nothing,
// which is the failure mode with a safety label on it.

import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import type { Tx } from './storage.ts'
import { then } from './pipe.ts'
import { sha256 } from './sha256.ts'
import { Refused } from './admit.ts'

/** A refused precondition: which column changed, and what it holds now. The
 * committed value is included so the caller can merge onto it. */
export class Stale extends Error {
  /**
   * @param eid the entity whose column changed
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

/** The token a caller puts in `$was`: the SHA-256 of a value it read, or
 * `null` when it read no value. One function, so both ends hash the same
 * way. */
export let token = (value: unknown): string | null =>
  value == null ? null : sha256(String(value))

/**
 * The precondition phase: check every `$was` the change carries against the
 * state as the change FOUND it, and throw {@link Stale} on the first column
 * that changed. It reads through the transaction, before anything in the
 * change has been written — a check made after the change's own writes would
 * refuse a value the change itself had just written.
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
