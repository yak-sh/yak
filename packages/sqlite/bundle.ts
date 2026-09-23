// The bundle: how the adapter returns an entity to a caller, and takes one
// back. The store keeps a component per table, but a caller thinks in whole
// entities, so a bundle gathers every component an entity has into one
// object.
//
//   { entity: { eid: 'cake-01' }, doc: { title: 'Lemon cake' }, recipe: { serves: 8 } }
//
// The shape itself is @yaks/graph's — the graph core owns the bundle format
// every yaks package shares, so this Layer-0 storage adapter depends on it
// rather than keeping a second definition that could drift. The identity is the
// `entity` component (`entity.eid` is the id, never a bare root `eid`); every
// other key is a component name mapping to its properties, or `null` to drop
// it. A bundle is also the write unit: `$delete: true` deletes the whole entity
// (tombstoned, death cascades), and `$was` carries per-property preconditions —
// fields this adapter carries but does not enforce (that check is a phase of
// @yaks/graph's apply(), not of a storage adapter).
//
// On the way out a bundle holds only the components the entity actually has,
// each a plain object of property values — references already resolved back to
// eids.

export type { Bundle, Comp, Entity, Was } from '@yaks/graph'
