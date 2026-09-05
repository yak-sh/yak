// Reading a bundle: which components an entity wears, what one column holds,
// and how to find another entity from a reference.
//
// A bundle is the whole entity — its identity under `entity`, every component
// it wears under that component's name. Storage keeps the same facts as one row
// per component table, so the two disagree in exactly two places, and both are
// smoothed here: a boolean is held as 0/1 (the way an integer column stores it),
// and a missing column and a missing component both read as `null`.
//
// A question about ANOTHER entity — a reference followed to its target, the
// backlinks of an id, the children pointing at a row — is answered from the
// bundle set the caller handed in. That set is the whole world for one run: an
// entity outside it does not exist, the same way a row outside a table does not.

import type { Bundle, Eid } from '@yaks/graph'
import { type Tag, tagOf } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'

/** The bundle set one run is answered from, with its entities addressable. */
export type Index = {
  /** every bundle, in the order given */
  list: readonly Bundle[]
  /** the bundle wearing an id, or `undefined` when the set holds no such entity */
  of: (eid: Eid) => Bundle | undefined
}

/** Index a bundle set by entity id. The given order is kept. */
export let index = (bundles: readonly Bundle[]): Index => {
  let by = new Map<Eid, Bundle>()
  for (let b of bundles) by.set(b.entity.eid, b)
  return { list: bundles, of: (eid) => by.get(eid) }
}

/**
 * One component of a bundle, or `undefined` when the entity does not wear it.
 * The identity (`entity`) and the `$`-prefixed wire sugar are not components.
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
 * Does the entity wear this component? The spine (`entity`) is worn by every
 * entity there is, so it always answers true.
 */
export let wears = (b: Bundle, name: string): boolean =>
  name == 'entity' || comp(b, name) != null

/**
 * Is this entity alive? A deleted entity is tombstoned rather than forgotten,
 * and every selection excludes the graves.
 */
export let live = (b: Bundle): boolean => !b.$delete && !wears(b, 'tombstone')

// A value as storage holds it: a boolean as 0/1, an absence as null.
let held = (v: unknown): unknown =>
  typeof v == 'boolean' ? Number(v) : v ?? null

/** One column's read out of a bundle, and how a value types against it. */
export type Read = { read: (b: Bundle) => unknown; tag: Tag }

/**
 * The computed-column registry, keyed `comp.prop`: the rule that READS a column
 * the vocabulary declares but never stores (`persist: false`). It is the
 * in-memory twin of {@link https://jsr.io/@yaks/sql/doc/~/Derived | @yaks/sql}'s
 * `derived` hook — the formula belongs to the application, not the schema, so
 * both compilers take it from the caller and one rule answers on both sides.
 * A registration also serves as a plain READ OVERRIDE for a stored column, the
 * way a derived entry does.
 */
export type Computed = Record<string, (b: Bundle) => unknown>

/**
 * How to read `comp.prop` off an entity, or `null` when there is nothing to
 * read: a column the vocabulary does not declare, or a computed one no rule was
 * registered for. The caller reports that as a decline.
 */
export let column = (
  v: Vocab,
  name: string,
  prop: string,
  computed: Computed = {},
): Read | null => {
  if (name == 'entity') {
    return {
      read: (b) => held((b.entity as Record<string, unknown>)[prop]),
      tag: 'text',
    }
  }
  if (prop == 'eid') {
    return { read: (b) => wears(b, name) ? b.entity.eid : null, tag: 'eid' }
  }
  let col = v.column(name, prop)
  if (!col) return null
  // The registered rule wins, computed column or not — the same order the SQL
  // binder consults its `derived` map in. The TYPE stays the vocabulary's: it
  // declares the column, the caller only says how to read it.
  let own = computed[`${name}.${prop}`]
  if (own) return { read: (b) => held(own(b)), tag: tagOf(col) }
  if (!col.persist) return null
  return { read: (b) => held(comp(b, name)?.[prop]), tag: tagOf(col) }
}
