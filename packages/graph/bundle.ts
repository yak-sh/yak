// The data format. Everything that passes between packages in this family — a
// read's result, a write request, a plugin's contribution to a transaction —
// is a BUNDLE: one entity plus the components to write to it or read from it.
//
//   { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } }
//
// The identity is INSIDE the bundle, under the `entity` key; every other key
// names a component. A write is a PATCH — an omitted column is left alone, a
// `null` column is cleared, a `null` component is removed — so a bundle
// contains what changes and nothing else.
//
// A few reserved keys are never stored as columns. `$delete` and the
// `tombstone` component both mean "delete this entity"; `$was` carries a
// per-column precondition; `$actor` names who is writing; `$num` asks the
// numbers plugin for a human-facing number. They are components in every sense
// that matters — data attached to an entity — they just exist only in transit
// and inside `apply()` rather than in a table. And that is where they stop:
// what `apply()` returns is composed (./compose.ts) with every `$` key stripped
// except `$alias`, which is how the graph tells the caller which id its
// `$name` became.

/** An entity's id: a string the client generates (a uuid, or a content hash).
 * A reference column reads back as the target's `eid`, so this is also the
 * type of a reference. */
export type Eid = string

/**
 * An entity's identity: an `eid` the client generated, and an optional
 * human-facing `num`. An explicit `null` reports an entity with no number;
 * absence makes no claim about numbering either way. `num` is optional —
 * storage assigns it, and an adapter with no use for a short human-facing
 * number never assigns one.
 */
export type Entity = {
  eid: Eid
  num?: number | null
  /** Portable archetype eid; the SQLite adapter stores its integer identity
   * row id. Derived, not caller-owned. Absent when archetype tracking is not
   * composed in. */
  archetype?: Eid
}

/** A component's columns — a flat object of scalar values, never nested. */
export type Comp = Record<string, unknown>

/**
 * A per-column precondition, keyed by component name then column name: the
 * SHA-256 of the value the caller read, or `null` for "I read no value".
 * `apply()` refuses the whole transaction if any named column has changed
 * since. It is carried on a bundle as `$was`, and works like git's
 * `--ff-only`: the write applies only onto the state it was based on.
 */
export type Was = Record<string, Record<string, string | null>>

/**
 * Who is writing, carried on a bundle like a component: the actor the stamp
 * phase records, and optionally the instrument the write came through. The
 * server that received the change decides whether to trust what a client sent
 * or replace it; `apply()` stamps whatever reaches it.
 */
export type Actor = { by?: Eid; via?: Eid }

/**
 * A patch for one entity. Its identity is under the `entity` key; every other
 * key names a component and maps to its columns, or to `null` to remove that
 * component. The reserved keys `$delete`, `$was`, `$num` and `$actor` look
 * like components but `apply()` acts on them rather than writing them as
 * columns.
 */
export type Bundle =
  & {
    /** the identity component: the entity this bundle is about */
    entity: Entity
    /** shorthand — delete the whole entity (it is tombstoned) */
    $delete?: boolean
    /** a per-column precondition that must still hold */
    $was?: Was
    /** ask storage for a human-facing number, for a new entity or an existing
     * one */
    $num?: boolean
    /** who is writing this transaction */
    $actor?: Actor
    /** the `$name` alias this bundle was referred to by, when the graph picked
     * its id */
    $alias?: Eid
    /** written, but not worth reporting: a bundle a plugin generated for its
     * own bookkeeping. It is patched, journaled and cascaded like any other,
     * and an entity that ONLY quiet bundles touched is left out of what
     * `apply()` returns (see ./compose.ts) */
    $quiet?: boolean
  }
  & {
    [comp: string]:
      | Comp
      | null
      | Entity
      | Was
      | Actor
      | boolean
      | string
      | undefined
  }

/** A flat list of bundles, applied in one transaction: `Change = Bundle[]`. */
export type Change = Bundle[]

/** The component name a deleted entity carries. Reading one back means the
 * entity is deleted; writing one is the long form of `$delete: true`. */
export let TOMBSTONE = 'tombstone'

/** The reserved keys that are not ordinary components: the identity and the
 * tombstone marker. (Everything starting with `$` is reserved too.) */
export let RESERVED: string[] = ['entity', TOMBSTONE]

/** The component patches a bundle carries, in the order they were written —
 * excluding the identity, the tombstone and the `$` keys. */
export let comps = (b: Bundle): [string, Comp | null][] =>
  Object.entries(b).filter(([k]) =>
    !RESERVED.includes(k) && !k.startsWith('$')
  ) as [string, Comp | null][]

/** Whether a bundle deletes its entity — written either way. */
export let dead = (b: Bundle): boolean =>
  b.$delete === true || b[TOMBSTONE] != null

/** A bundle reporting that an entity was deleted: what `apply()` generates for
 * each entity a cascade took with it, and what a read returns for a tombstoned
 * entity. */
export let tombstoned = (entity: Entity): Bundle => ({
  entity,
  [TOMBSTONE]: {},
})
