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
import type { Hop, Vocab } from '@yaks/vocab'

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
  /** The entities a pending change took this component off: what a removal
   * clause (`-comp`) asks. Only a store evaluating a change it has not
   * committed has an answer (@yaks/ram's rules); without one, nothing was
   * removed and the clause holds for nobody. */
  gone?: (comp: string) => ReadonlySet<Eid> | undefined
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
  b: Record<string, unknown>,
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
export let wears = (b: Record<string, unknown>, name: string): boolean =>
  name == 'entity' || comp(b, name) != null

/**
 * The entity a path's leaf is read from: the first hop's reference read off
 * this bundle, each later hop but the last read off the entity before it, each
 * step looked up among the rest. An entity missing anywhere along the way, or
 * a reference holding no id, reaches nothing, as a missing row does.
 */
export let follow =
  (hops: Hop[]) => (b: Bundle, among: Index): Bundle | undefined => {
    let eid = comp(b, hops[0].comp)?.[hops[0].prop]
    for (let h of hops.slice(1, -1)) {
      if (typeof eid != 'string') return undefined
      let next = among.of(eid)
      eid = next && comp(next, h.comp)?.[h.prop]
    }
    return typeof eid == 'string' ? among.of(eid) : undefined
  }

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
 * The status a component's ladder gives this entity, a bundle or any bag of
 * its components (@yaks/vocab's `status`
 * keyword): the first rung it wears, else the status the bundle carries, else
 * the ladder's default. An entity without the component has none, and reads
 * `null`, the nothing a database reads for it.
 *
 * The carried status is what a store read with its whole ladder, so it holds
 * where the rungs are missing: a read answers the components it names, and
 * `.task` alone brings the status without the `completed` behind it. A rung
 * the bundle does carry wins over it, because a rung written here is newer
 * evidence than the status read before it. A vocabulary that declares no
 * ladder for the component reads only what is carried.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 *
 * let v = loadVocab({ $defs: {
 *   job: { component: true, type: 'object',
 *     status: { failed: 'failed', default: 'pending' } },
 *   failed: { component: true, type: 'object' },
 * } })
 * let job = { entity: { eid: 'j1' }, job: {} }
 * assertEquals(statusOf(v, 'job', job), 'pending')
 * assertEquals(statusOf(v, 'job', { ...job, failed: {} }), 'failed')
 * assertEquals(statusOf(v, 'job', { ...job, job: { status: 'failed' } }), 'failed')
 * assertEquals(statusOf(v, 'job', { entity: { eid: 'x' } }), null)
 * ```
 */
export let statusOf = (
  v: Vocab,
  name: string,
  b: Record<string, unknown>,
): string | null => {
  let own = comp(b, name)
  if (!own) return null
  let l = v.comp(name)?.ladder
  let carried = typeof own.status == 'string' ? own.status : undefined
  return l?.rungs.find((r) => wears(b, r.comp))?.status ?? carried ??
    l?.default ?? null
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
  // A ladder's status is read from the vocabulary's own declaration, and like
  // a stored value it is null for an entity without the component.
  if (prop == 'status' && v.comp(name)?.ladder) {
    return {
      read: (b) => statusOf(v, name, b),
      tag: tagOf(def),
      bound: true,
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
