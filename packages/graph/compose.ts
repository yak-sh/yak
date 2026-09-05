// The answer: the batch as applied, said one bundle per entity.
//
// Every phase of `apply()` speaks in PATCHES, and each adds its own bundle —
// the write a caller sent, the `created` the stamp phase made, the identity
// storage minted with its `num`, the tombstone a cascade left. That is right
// inside the pipeline, where a phase must be able to add a fact without
// reaching into a bundle another phase is holding. It is wrong as an ANSWER: a
// caller asked about an entity, and three bundles for one entity is a merge it
// has to do itself before it can see what it just wrote.
//
// So the last thing `apply()` does is put them back together:
//
//   { entity: { eid, num }, doc: {…}, created: {…}, $alias: '$new' }
//
// The `$` keys are the pipeline's own — `$actor` names who is writing, `$was`
// guards a column, `$effect` counts an effect's generations, `$before` carries
// a reading from one phase to a later one — and the pipeline ends here, so they
// come off (D-33490 gate 6: a component may be wire, db, or pipeline-only, and
// a pipeline-only one never leaves `apply()`). `$alias` is the one that stays:
// it is an ANSWER rather than a request, the caller's own word for an entity
// whose id it could not know, and the only channel that maps the two.
//
// Death is total. An entity this batch killed answers as the tombstone alone,
// whatever the batch said about it on the way in — a cache that keeps the doc
// row of a deleted entity keeps a ghost.
//
// The RAW phase output is still there for whoever needs it: every hook is
// handed it inside the pipeline, and a dry run's {@link Checked} carries it to
// the `audit` hooks. This is what the caller is answered, not what the phases
// said to each other.

import type { Bundle, Eid } from './bundle.ts'
import { comps, dead, TOMBSTONE } from './bundle.ts'

/**
 * A batch of patches composed into one bundle per entity, in the order the
 * batch first named each: the identity with whatever `num` storage minted,
 * every component as applied, the `$alias` it was named by, and no other `$`
 * key. An entity the batch killed answers as `{entity, tombstone: {}}`.
 *
 * ```ts
 * composed([
 *   { entity: { eid: 'b1' }, doc: { title: 'Dune' }, $actor: { by: 'ada' } },
 *   { entity: { eid: 'b1' }, created: { at: NOW, by: 'ada' } },
 *   { entity: { eid: 'b1', num: 3 } },
 * ])
 * // [{ entity: { eid: 'b1', num: 3 },
 * //    doc: { title: 'Dune' }, created: { at: NOW, by: 'ada' } }]
 * ```
 */
export let composed = (bundles: Bundle[]): Bundle[] => {
  let by = new Map<Eid, Bundle>()
  let gone = new Set<Eid>()
  for (let b of bundles) {
    let eid = b.entity.eid
    let one = by.get(eid) ?? { entity: { eid } }
    by.set(eid, one)
    // The identity is merged rather than replaced: only the phase that minted
    // it knows the `num`, and only the caller's own bundle carries the alias.
    // The FIRST number wins, so a batch stitched from several stores reads the
    // way a query over them does — a num is one store's own counter, and the
    // eid is what the entity is called everywhere.
    if (b.entity.num != null && one.entity.num == null) {
      one.entity = { ...one.entity, num: b.entity.num }
    }
    if (typeof b.$alias == 'string') one.$alias = b.$alias
    if (dead(b)) gone.add(eid)
    for (let [name, comp] of comps(b)) one[name] = comp
  }
  return [...by.values()].map((b) =>
    gone.has(b.entity.eid)
      ? {
        entity: b.entity,
        ...(typeof b.$alias == 'string' ? { $alias: b.$alias } : {}),
        [TOMBSTONE]: {},
      }
      : b
  )
}
