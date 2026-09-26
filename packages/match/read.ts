// Reading a bundle: which components an entity has, what one property holds,
// and how to find another entity from a reference.
//
// A bundle is the whole entity — its identity under `entity`, every component
// under that component's name. Storage keeps the same facts as one row per
// component table, so the two representations differ in exactly two places, and
// both are smoothed over here: a boolean is read as 0/1 (the way an integer
// property stores it), and a missing property and a missing component both read
// as `null`.
//
// A question about another entity — a reference followed to its target, the
// backlinks of an id, the children pointing at a row — is answered from the
// array of bundles the caller handed in. That array is all the data one run can
// see: an entity outside it does not exist, the same way a row outside a table
// does not.

import { type Tag, tagOf } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'

/** An entity's id: a client-minted string (a uuid, or a content hash). */
export type Eid = string

/**
 * A bundle, as this package reads one: the identity under `entity`, every
 * component under its own name, properties inside.
 *
 * It is the structural shape a matcher needs, and deliberately not an import of
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}'s `Bundle` — which is one of
 * these, and passes wherever this type is asked for. @yaks/graph imports this
 * package to compile its rules, so the dependency between the two has to run
 * one direction, and this is the leaf end of it.
 */
export type Bundle = {
  /** the identity component: the entity this bundle is about */
  entity: { eid: Eid; num?: number | null }
  /** a component's properties, `null` where the component is being deleted, or
   * one of the `$`-prefixed markers a client may include alongside them */
  [comp: string]:
    | Record<string, unknown>
    | null
    | boolean
    | string
    | undefined
}

/**
 * The bundles one run is answered from. `list` and `of` are every source's: a
 * scan, and a lookup by id, which is how a reference is followed. A store that
 * keeps its entities apart by component or by value offers `wearing`, `keyed`
 * and `ranged` as well, and a query that can only match entities wearing a
 * component (or holding a value, or a number between two bounds) reads those
 * instead of scanning `list` — the way a database reads an index instead of the
 * table. Either way every candidate is still tested, so an index only decides
 * how much is read, never what matches.
 */
export type Index = {
  /** every bundle, in the order given */
  readonly list: readonly Bundle[]
  /** the bundle with that id, or `undefined` when there is no such entity */
  of: (eid: Eid) => Bundle | undefined
  /** the bundles wearing this component, by id */
  wearing?: (comp: string) => ReadonlyMap<Eid, Bundle>
  /** the bundles whose `comp.prop` files under this key ({@link keyOf}), by
   * id */
  keyed?: (comp: string, prop: string, key: string) => ReadonlyMap<Eid, Bundle>
  /** Groups of bundles, by id, that between them hold every bundle whose
   * `comp.prop`, read as a number, lies from `lo` to `hi` inclusive; a group
   * may hold others too. */
  ranged?: (
    comp: string,
    prop: string,
    lo: number,
    hi: number,
  ) => ReadonlyMap<Eid, Bundle>[]
}

/**
 * Index an array of bundles by entity id. The given order is kept, and nothing
 * is built until something asks: a query that never follows a reference never
 * pays for the map.
 */
export let index = (bundles: readonly Bundle[]): Index => {
  let by: Map<Eid, Bundle> | undefined
  return {
    list: bundles,
    of: (eid) => {
      if (!by) {
        by = new Map()
        for (let b of bundles) by.set(b.entity.eid, b)
      }
      return by.get(eid)
    },
  }
}

/**
 * The key a property's value is filed under in a {@link Index.keyed} index:
 * the value as storage reads it, as text. Equality on a text, enum or eid
 * property is exactly "files under the operand", so those are the lookups a
 * query hands to a keyed index. An absent value files under nothing.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 *
 * assertEquals(keyOf('open'), 'open')
 * assertEquals(keyOf(true), '1')
 * assertEquals(keyOf(null), undefined)
 * ```
 */
export let keyOf = (v: unknown): string | undefined =>
  v == null ? undefined : String(held(v))

/**
 * One component of a bundle, or `undefined` when the entity does not have it.
 * The identity (`entity`) and the `$`-prefixed markers are not components.
 */
export let comp = (
  b: Bundle,
  name: string,
): Record<string, unknown> | undefined => {
  let c = b[name]
  return c != null && typeof c == 'object'
    ? c as Record<string, unknown>
    : undefined
}

/**
 * Does the entity have this component? The identity component (`entity`) is on
 * every entity there is, so it always returns true.
 */
export let wears = (b: Bundle, name: string): boolean =>
  name == 'entity' || comp(b, name) != null

/**
 * Is this entity still present? A deleted entity keeps a `tombstone` component
 * rather than disappearing, and every selection leaves tombstoned entities out.
 */
export let live = (b: Bundle): boolean => !b.$delete && !wears(b, 'tombstone')

// A value as storage holds it: a boolean as 0/1, an absence as null.
let held = (v: unknown): unknown =>
  typeof v == 'boolean' ? Number(v) : v ?? null

/** How to read one property out of a bundle, which type a value compares
 * against it as, whether it reads as absent on every entity that does not wear
 * the component (not so for a computed property, whose rule may answer from
 * other components), and whether it is a value the component stores — what a
 * {@link Index.keyed} index files. */
export type Read = {
  read: (b: Bundle) => unknown
  tag: Tag
  bound: boolean
  stored: boolean
}

/**
 * The computed-property registry, keyed `comp.prop`: the function that reads a
 * property the vocabulary declares but never stores (`computed: true`). It is
 * the in-memory equivalent of {@link https://jsr.io/@yaks/sql/doc/~/Derived |
 * @yaks/sql}'s `derived` hook — the formula belongs to the application rather
 * than the schema, so both compilers take it from the caller and one rule
 * serves both sides. A registration also works as a plain read override for a
 * stored property, the way a `derived` entry does.
 */
export type Computed = Record<string, (b: Bundle) => unknown>

/**
 * How to read `comp.prop` off an entity, or `null` when there is nothing to
 * read: a property the vocabulary does not declare, or a computed one no rule
 * was registered for. The caller turns that into an `Unsupported` refusal.
 */
export let reader = (
  v: Vocab,
  name: string,
  prop: string,
  computed: Computed = {},
): Read | null => {
  if (name == 'entity') {
    return {
      read: (b) => held((b.entity as Record<string, unknown>)[prop]),
      tag: 'text',
      bound: false,
      stored: false,
    }
  }
  if (prop == 'eid') {
    return {
      read: (b) => wears(b, name) ? b.entity.eid : null,
      tag: 'eid',
      bound: true,
      stored: false,
    }
  }
  let def = v.prop(name, prop)
  if (!def) return null
  // A registered rule wins, computed property or not — the same order the SQL
  // binder consults its `derived` map in. The type stays the vocabulary's: the
  // vocabulary declares the property, the caller only supplies the read.
  let own = computed[`${name}.${prop}`]
  if (own) {
    return {
      read: (b) => held(own(b)),
      tag: tagOf(def),
      bound: false,
      stored: false,
    }
  }
  if (def.computed) return null
  return {
    read: (b) => held(comp(b, name)?.[prop]),
    tag: tagOf(def),
    bound: true,
    stored: true,
  }
}
