// The return value: the change as applied, as one bundle per entity.
//
// Every phase of `apply()` works in PATCHES, and each adds its own bundle —
// the write the caller sent, the `created` the stamp phase produced, the
// identity storage created with its `num`, the tombstone a cascade left. That
// is right inside the pipeline, where a phase must be able to add something
// without reaching into a bundle another phase is holding. It is wrong as a
// RETURN VALUE: the caller asked about an entity, and three bundles for one
// entity is a merge it has to do itself before it can see what it just wrote.
//
// So the last thing `apply()` does is put them back together:
//
//   { entity: { eid, num }, doc: {…}, created: {…}, $alias: '$new' }
//
// The `$` keys belong to the pipeline — `$actor` names who is writing, `$was`
// carries a precondition, `$effect` counts an effect's generations, `$before`
// carries a reading from one phase to a later one — and the pipeline ends
// here, so they are stripped (D-33490: a component may be client-writable,
// stored, or pipeline-only, and a pipeline-only one never leaves `apply()`).
// `$alias` is the one that stays: it is part of the answer rather than the
// request, the caller's own placeholder for an entity whose id it could not
// know, and the only thing that maps the two.
//
// `$quiet` is the same rule applied to a whole bundle instead of one key: a
// plugin's own bookkeeping, written and journaled with everything else, and an
// entity that only quiet bundles touched is left out of the return value.
// @yaks/archetype is the reason — classifying an entity creates a descriptor
// and may change the archetype of some entity the change merely referenced,
// and a caller that wrote one recipe gets one recipe back, with whatever
// archetype the classification gave it.
//
// A delete overrides everything. An entity this change deleted comes back as
// the tombstone alone, whatever the change said about it on the way in — a
// cache that keeps the doc row of a deleted entity keeps a row that no longer
// exists.
//
// The uncomposed phase output is still available to whoever needs it: every
// hook is handed it inside the pipeline, and a dry run's {@link Checked}
// carries it to the `audit` hooks. What this file produces is what the caller
// gets back, not what the phases passed to each other.

import type { Bundle, Comp, Eid } from './bundle.ts'
import { comps, dead, TOMBSTONE } from './bundle.ts'

/**
 * A list of patches composed into one bundle per entity, in the order the
 * change first named each one: the identity with whatever `num` storage
 * assigned, every component as applied, the `$alias` the caller referred to it
 * by, and no other `$` key. An entity the change deleted comes back as
 * `{entity, tombstone: {}}`.
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
  let said = new Set<Eid>()
  for (let b of bundles) {
    let eid = b.entity.eid
    let one = by.get(eid) ?? { entity: { eid } }
    by.set(eid, one)
    if (!b.$quiet) said.add(eid)
    // The identity is merged rather than replaced: only the phase that created
    // it knows the `num`, and only the caller's own bundle carries the alias.
    // The FIRST number wins, so a change spread across several stores reads
    // the way a query over them does — a num is one store's own counter, while
    // the eid identifies the entity everywhere.
    if (b.entity.num !== undefined && one.entity.num == null) {
      one.entity = { ...one.entity, num: b.entity.num }
    }
    if (b.entity.archetype !== undefined) {
      one.entity.archetype = b.entity.archetype
    }
    if (typeof b.$alias == 'string') one.$alias = b.$alias
    if (dead(b)) gone.add(eid)
    for (let [name, comp] of comps(b)) {
      one[name] = comp == null
        ? null
        : { ...(one[name] as Comp | null ?? {}), ...comp }
    }
  }
  return [...by.values()].filter((b) => said.has(b.entity.eid)).map((b) =>
    gone.has(b.entity.eid)
      ? {
        entity: b.entity,
        ...(typeof b.$alias == 'string' ? { $alias: b.$alias } : {}),
        [TOMBSTONE]: {},
      }
      : b
  )
}
