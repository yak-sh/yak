// The bundle: how the adapter hands an entity to a caller, and takes one back.
// The store keeps a component per table, but a caller thinks in whole entities,
// so a bundle gathers every component an entity wears under one roof.
//
//   { entity: { eid: 'cake-01' }, doc: { title: 'Lemon cake' }, recipe: { serves: 8 } }
//
// The shape itself is @yaks/graph's — the graph core owns the wire every yaks
// package shares, so this Layer-0 storage adapter DEPENDS on it rather than
// keeping a second definition that could drift. The identity is the `entity`
// component (`entity.eid` is the id, never a bare root `eid`); every other key is
// a component name mapping to its columns, or `null` to drop it. A bundle is also
// the write unit (`Change = Bundle[]`): `$delete: true` deletes the whole entity
// (tombstoned, death cascades), and `$was` carries per-column preconditions —
// sugar this adapter carries but does not enforce (that gate is a phase of
// @yaks/graph's apply(), not of a storage adapter).
//
// On the way OUT a bundle holds only the components the entity actually has, each
// a plain object of column values — references already resolved back to eids.

export type { Bundle, Change, Comp, Entity, Was } from '@yaks/graph'
