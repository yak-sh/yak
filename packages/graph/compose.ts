// The return value: the batch as applied, as one bundle per entity.
//
// Every phase of `apply()` works in patches, and each adds its own bundle —
// the write the caller sent, the `created` the stamp phase produced, the
// identity storage created with its `num`, the tombstone a cascade left. That
// is right inside the pipeline, where a phase must be able to add something
// without reaching into a bundle another phase is holding. It is wrong as a
// return value: the caller asked about an entity, and three bundles for one
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
// and may change the archetype of some entity the batch merely referenced,
// and a caller that wrote one recipe gets one recipe back, with whatever
// archetype the classification gave it.
//
// A delete overrides everything. An entity this batch deleted comes back as
// the tombstone alone, whatever the batch said about it on the way in — a
// cache that keeps the doc row of a deleted entity keeps a row that no longer
// exists.
//
// The uncomposed phase output is still available to whoever needs it: every
// hook is handed it inside the pipeline, and a dry run's {@link Checked}
// carries it to the `audit` hooks. What this file produces is what the caller
// gets back, not what the phases passed to each other.

export { composed } from './bundle.ts'
