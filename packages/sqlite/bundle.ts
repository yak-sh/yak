// The bundle: how the adapter hands an entity to a caller, and takes one back.
// The store keeps a component per table, but a caller thinks in whole entities,
// so a bundle gathers every component an entity wears under one roof.
//
//   { entity: { eid: 'cake-01' }, doc: { title: 'Lemon cake' }, recipe: { serves: 8 } }
//
// The identity is the `entity` component — the string `eid` (and the
// server-minted `num` once it exists). It is NOT a bare `eid` at the bundle
// root: identity is a component like any other, so the shape stays uniform and
// composes with the rest of the yaks stack (@yaks/graph's canonical `Bundle`).
// Every other key is a component name mapping to that component's columns.
//
// A bundle is also the WRITE unit: `Change = Bundle[]`. On the way IN a component
// may be `null`, which drops it; `$delete: true` deletes the whole entity
// (tombstoned, death cascades); `$was` carries per-column preconditions. On the
// way OUT a bundle holds only the components the entity actually has, each a
// plain object of column values — references already resolved back to eids.

// A component's columns: a flat bag of scalar values (a reference reads back as
// the target's eid string). Never nested — a column holds one value.
export type Comp = Record<string, unknown>

// The identity component: the entity's string id, and the server-minted `num`
// once the spine exists. `eid` lives HERE, never at the bundle root.
export type Ident = { eid: string; num?: number }

// Per-column preconditions ($was): the value each named column was read as,
// keyed component → column. The adapter CARRIES this sugar so a bundle that
// rides one keeps its shape, but does not ENFORCE it — the precondition gate is
// a phase of @yaks/graph's apply(), not of a storage adapter.
export type Was = Record<string, Record<string, unknown>>

// An entity and its components. `entity` is the identity; `$delete`/`$was` are
// reserved sugar (any `$`-prefixed key is sugar, never a component); every other
// key is a component name mapping to its columns, or `null` to drop it.
//
// NOTE: this shape is @yaks/graph's canonical `Bundle`. @yaks/graph does not yet
// exist as a package; when it does, import `Bundle`/`Change` from it and delete
// this local definition.
export type Bundle = {
  entity: Ident
  $delete?: boolean
  $was?: Was
  [comp: string]: Comp | Ident | Was | boolean | null | undefined
}

// The wire and the write unit: a flat batch of bundles, applied in order.
export type Change = Bundle[]
