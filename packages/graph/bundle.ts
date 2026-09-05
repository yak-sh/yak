// The wire. Everything that crosses a seam in this family — a read's answer, a
// write's request, a plugin's contribution to a batch — is a BUNDLE: one
// entity plus the components to write to it or read from it.
//
//   { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } }
//
// The identity rides INSIDE the bundle, under the `entity` key; every other
// key names a component. A write is a PATCH — an omitted column is untouched,
// a `null` column is cleared, a `null` component is dropped — so a bundle says
// what changes and nothing else.
//
// Three keys are reserved and never stored as columns. `$delete` and the
// `tombstone` component both mean "this entity dies"; `$was` carries a
// per-column precondition; `$actor` names who is writing. They are components
// in every sense that matters — data associated with an entity — they just
// live on the wire and inside `apply()` rather than in a table.

/** An entity's id: a client-minted string (a uuid, or a content hash). A
 * reference column reads back as the target's `eid`, so this is also the type
 * of a reference. */
export type Eid = string

/**
 * An entity's identity: a client-minted `eid`, and the `num` storage mints on
 * first touch. `num` is optional — it is storage's to hand out, and an adapter
 * that has no use for a small human-facing number never mints one.
 */
export type Entity = { eid: Eid; num?: number }

/** A component's columns — a flat bag of scalar values, never nested. */
export type Comp = Record<string, unknown>

/**
 * A per-column precondition, keyed by component name then column name: the
 * SHA-256 of the value the caller read, or `null` for "I read no value".
 * `apply()` refuses the whole batch if any named column has moved. Rides a
 * bundle as `$was` — the graph's `--ff-only`.
 */
export type Was = Record<string, Record<string, string | null>>

/**
 * Who is writing, as a component riding the batch: the actor a stamp records,
 * and optionally the instrument it was written through. The door that received
 * the batch decides whether to trust what a client sent or overwrite it;
 * `apply()` stamps whatever reached it.
 */
export type Actor = { by?: Eid; via?: Eid }

/**
 * A patch for one entity. Its identity rides under the `entity` key; every
 * other key names a component mapping to its columns, or `null` to drop that
 * component. The reserved keys `$delete`, `$was` and `$actor` are components
 * `apply()` reads rather than columns it writes.
 */
export type Bundle =
  & {
    /** the identity component: the entity this bundle is about */
    entity: Entity
    /** sugar — delete the whole entity (it is tombstoned) */
    $delete?: boolean
    /** a per-column precondition that must still hold */
    $was?: Was
    /** who is writing this batch */
    $actor?: Actor
  }
  & { [comp: string]: Comp | null | Entity | Was | Actor | boolean | undefined }

/** A flat batch of bundles, applied atomically: `Change = Bundle[]`. */
export type Change = Bundle[]

/** The component name a dead entity wears. Reading one back says it is dead;
 * writing one is the long spelling of `$delete: true`. */
export let TOMBSTONE = 'tombstone'

/** The reserved keys that are not ordinary components: the identity and the
 * tombstone marker. (Everything starting with `$` is reserved too.) */
export let RESERVED: string[] = ['entity', TOMBSTONE]

/** The component patches a bundle carries, in the order they were written —
 * identity, tombstone and `$`-sugar excluded. */
export let comps = (b: Bundle): [string, Comp | null][] =>
  Object.entries(b).filter(([k]) =>
    !RESERVED.includes(k) && !k.startsWith('$')
  ) as [string, Comp | null][]

/** Whether a bundle says its entity is dead — either spelling. */
export let dead = (b: Bundle): boolean =>
  b.$delete === true || b[TOMBSTONE] != null

/** A bundle that says an entity died: what `apply()` synthesizes for each
 * casualty of a cascade, and what a read returns for a tombstoned entity. */
export let tombstoned = (entity: Entity): Bundle => ({
  entity,
  [TOMBSTONE]: {},
})
