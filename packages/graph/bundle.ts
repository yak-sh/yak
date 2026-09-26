// The data format. Everything that passes between packages in this family — a
// read's result, a write request, a plugin's contribution to a transaction —
// is a bundle: one entity plus the components to write to it or read from it.
//
//   { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } }
//
// The identity is inside the bundle, under the `entity` key; every other key
// names a component. A write is a PATCH — an omitted property is left alone, a
// `null` property is cleared, a `null` component is removed — so a bundle
// contains what changes and nothing else.
//
// A few reserved keys are never stored as properties. `$delete` and the
// `tombstone` component both mean "delete this entity"; `$was` carries a
// per-property precondition; `$actor` names who is writing. They are components
// in every sense that matters — data attached to an entity — they just exist
// only in transit and inside `apply()` rather than in a table. A plugin adds
// requests of its own by declaring them (./request.ts), and a `$` key nothing
// declared is refused. And that is where they stop:
// what `apply()` returns is composed (./compose.ts) with every `$` key stripped
// except `$alias`, which is how the graph tells the caller which id its
// `$name` became.

/** An entity's id: a string the client generates (a uuid, or a content hash).
 * A reference property reads back as the target's `eid`, so this is also the
 * type of a reference. */
export type Eid = string

/**
 * An entity's identity: an `eid` the client generated, and whatever the store
 * keeps beside it. `num` is a human-facing number, present only where the
 * plugin that allocates one is registered (@yaks/id): an explicit `null`
 * reports an entity with no number, and absence makes no claim either way.
 */
export type Entity = {
  eid: Eid
  num?: number | null
  /** Portable archetype eid; the SQLite adapter stores its integer identity
   * row id. Derived, not caller-owned. Absent when archetype tracking is not
   * composed in. */
  archetype?: Eid
}

/** A component's properties — a flat object of scalar values, never nested. */
export type Comp = Record<string, unknown>

/**
 * A per-property precondition, keyed by component name then property name: the
 * SHA-256 of the value the caller read, or `null` for "I read no value".
 * `apply()` refuses the whole transaction if any named property has changed
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
 * key names a component and maps to its properties, or to `null` to remove that
 * component. The reserved keys `$delete`, `$was` and `$actor` look like
 * components but `apply()` acts on them rather than writing them as properties,
 * and a plugin may declare requests of its own.
 */
export type Bundle =
  & {
    /** the identity component: the entity this bundle is about */
    entity: Entity
    /** shorthand — delete the whole entity (it is tombstoned) */
    $delete?: boolean
    /** a per-property precondition that must still hold */
    $was?: Was
    /** who is writing this transaction */
    $actor?: Actor
    /** the `$name` alias this bundle was referred to by, when the graph picked
     * its id */
    $alias?: Eid
    /** written, but not worth reporting: a bundle a plugin generated for its
     * own bookkeeping. It is patched, journaled and cascaded like any other,
     * and an entity that only quiet bundles touched is left out of what
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

/** The component name a deleted entity carries. Reading one back means the
 * entity is deleted; writing one is the long form of `$delete: true`. */
export let TOMBSTONE = 'tombstone'

/** Whether a bundle's key is something other than a component: the identity,
 * the tombstone marker, or one of the pipeline's `$` keys. */
export let reserved = (k: string): boolean =>
  k == 'entity' || k == TOMBSTONE || k[0] == '$'

/** The component patches a bundle carries, in the order they were written —
 * excluding the identity, the tombstone and the `$` keys. */
export let comps = (b: Bundle): [string, Comp | null][] => {
  let out: [string, Comp | null][] = []
  for (let k of Object.keys(b)) {
    if (!reserved(k)) out.push([k, b[k] as Comp | null])
  }
  return out
}

/** Whether a bundle deletes its entity — written either way. */
export let dead = (b: Bundle): boolean =>
  b.$delete === true || b[TOMBSTONE] != null

/** Whether a bundle gives its entity a component, rather than only removing
 * some. An entity comes into being, or back from its tombstone, only with one.
 *
 * ```ts
 * gives({ entity: { eid: 'a' }, doc: { title: 'Dune' } }) // true
 * gives({ entity: { eid: 'a' }, doc: null }) // false
 * ```
 */
export let gives = (b: Bundle): boolean => comps(b).some(([, c]) => c != null)

/** Whether a bundle raced a delete: its `$was` names a value the writer read,
 * which a tombstoned entity no longer holds. A `$was` naming only `null` read
 * nothing, and is a blind write.
 *
 * ```ts
 * raced({ entity: { eid: 'a' }, $was: { doc: { title: 'f00d' } } }) // true
 * raced({ entity: { eid: 'a' }, $was: { doc: { title: null } } }) // false
 * raced({ entity: { eid: 'a' } }) // false
 * ```
 */
export let raced = (b: Bundle): boolean =>
  Object.values(b.$was ?? {}).some((props) =>
    Object.values(props).some((t) => t != null)
  )

/** A bundle reporting that an entity was deleted: what `apply()` generates for
 * each entity a cascade took with it, and what a read returns for a tombstoned
 * entity. */
export let tombstoned = (entity: Entity): Bundle => ({
  entity,
  [TOMBSTONE]: {},
})
