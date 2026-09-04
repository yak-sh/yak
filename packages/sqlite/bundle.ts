// The bundle: how the adapter hands an entity to a caller, and takes one back.
// The store keeps a component per table, but a caller thinks in whole entities,
// so a bundle gathers every component an entity wears under one roof.
//
//   { eid: 'cake-01', doc: { title: 'Lemon cake' }, recipe: { serves: 8 } }
//
// The entity's string id lives under `eid`; every other key is a component name
// mapping to that component's columns. On the way IN (a write) a component may
// be `null`, which drops it, and the reserved key `entity` set to `null` drops
// the whole entity. On the way OUT (a read) a bundle holds only the components
// the entity actually has, each a plain object of column values — references
// already resolved back to the eids they point at.

// A component's columns: a flat bag of scalar values (a reference reads back as
// the target's eid string). Never nested — a column holds one value.
export type Comp = Record<string, unknown>

// An entity and its components. `eid` is the id; the index signature covers the
// component keys, and admits `string` so `eid` itself fits the shape.
export type Bundle = { eid: string; [comp: string]: Comp | null | string }
