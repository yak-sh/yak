// The precondition: a write that states the value it was based on. `$was`
// carries, per property, the SHA-256 of the value the caller read (or `null`
// for "I read no value"); if the stored value has changed since, the whole
// change is refused and the committed value is reported back, so the caller can
// merge onto it rather than overwriting a writer it never saw. It works like
// git's `--ff-only`.
//
// Two details matter, and both are the difference between a check that works
// and one that only looks like it does. The change is refused as A whole: a
// change guarding two properties that loses one of them must apply neither, or
// you end up with a title from one writer and a body from another. And every
// property named must be declared — a check on a property that does not exist
// would read `undefined`, compare equal to "absent", and protect nothing,
// which is the failure mode with a safety label on it.
//
// An entity deleted since it was read is not stale but gone. Its `$was` is
// still checked for names, then left to the mutate phase, which swallows a
// write that raced a delete (./mutate.ts) rather than refusing the change
// around it.

import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { dead } from './bundle.ts'
import type { Tx } from './storage.ts'
import { then } from './pipe.ts'
import { sha256 } from './sha256.ts'
import { Refused } from './admit.ts'

/** A refused precondition: which property changed, and what it holds now. The
 * committed value is included so the caller can merge onto it. */
export class Stale extends Error {
  /**
   * @param eid the entity whose property changed
   * @param comp the component it lives on
   * @param prop the property itself
   * @param current the value the graph holds now (`null` if it holds none)
   */
  constructor(
    public eid: Eid,
    public comp: string,
    public prop: string,
    public current: unknown,
  ) {
    super(`${comp}.${prop} of ${eid} has moved since it was read`)
    this.name = 'Stale'
  }
}

/** The token a caller puts in `$was`: the SHA-256 of a value it read, or
 * `null` when it read no value. One function, so both ends hash the same
 * way. A JSON value (an `object` or `array` property) is hashed as its JSON
 * text, so two different objects never share a token. */
export let token = (value: unknown): string | null =>
  value == null
    ? null
    : sha256(typeof value == 'object' ? JSON.stringify(value) : String(value))

/**
 * The precondition phase: check every `$was` the change carries against the
 * state as the change found it, and throw {@link Stale} on the first property
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
      let buried = !!stored && dead(stored)
      for (let [comp, props] of Object.entries(b.$was!)) {
        if (!vocab.comp(comp)) {
          throw new Refused(`unknown component in $was: ${comp}`)
        }
        let declared = new Set(vocab.props(comp))
        for (let [prop, want] of Object.entries(props)) {
          if (!declared.has(prop)) {
            throw new Refused(`unknown property in $was: ${comp}.${prop}`)
          }
          if (buried) continue
          let cur = (stored?.[comp] as Comp | undefined)?.[prop] ?? null
          if (token(cur) != want) {
            throw new Stale(b.entity.eid, comp, prop, cur)
          }
        }
      }
    }
    return bundles
  })
}
