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

import { Misfit } from './errors.ts'

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
 * server that received the batch decides whether to trust what a client sent
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
    /** remove an exact malformed identity only when it holds nothing and no
     * references point at it; generated identities cannot be pruned */
    $prune?: boolean
    /** a per-property precondition that must still hold */
    $was?: Was
    /** who is writing this entity: an entity whose bundles name nobody is
     * written by the batch's writer, the first one it names */
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
  for (let k in b) if (!reserved(k)) out.push([k, b[k] as Comp | null])
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

/** Whether a whole stored row is a live entity, rather than an empty identity
 * or a tombstone. */
export let alive = (b: Bundle | undefined): b is Bundle =>
  !!b && !dead(b) && gives(b)

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

/**
 * A list of patches composed into one bundle per entity, in the order the
 * batch first named each one: the identity with whatever `num` storage
 * assigned, every component as applied, the `$alias` the caller referred to it
 * by, and no other `$` key. An entity the batch deleted comes back as
 * `{entity, tombstone: {}}`.
 *
 * ```ts
 * import { composed } from '@yaks/graph'
 *
 * let now = '2026-09-25T12:00:00.000Z'
 * composed([
 *   { entity: { eid: 'b1' }, doc: { title: 'Dune' }, $actor: { by: 'ada' } },
 *   { entity: { eid: 'b1' }, created: { at: now, by: 'ada' } },
 *   { entity: { eid: 'b1', num: 3 } },
 * ])
 * // [{ entity: { eid: 'b1', num: 3 },
 * //    doc: { title: 'Dune' }, created: { at: now, by: 'ada' } }]
 * ```
 */
export let composed = (bundles: Bundle[]): Bundle[] => {
  let { by, gone, said } = folded(bundles)
  return [...by.values()].filter((b) => said.has(b.entity.eid)).map((b) =>
    gone.has(b.entity.eid)
      ? {
        entity: b.entity,
        ...(typeof b.$alias == 'string' ? { $alias: b.$alias } : {}),
        [TOMBSTONE]: {},
      }
      : b
  )
}

// The patches folded into one bundle per entity, with the entities something
// other than a quiet bundle named and the ones deleted.
//
// The loop is the whole function, and what it returns is built before it
// starts. The first batch a graph applies can be a whole world, and V8
// compiles a function whose first call spends that long in one loop while it
// is still inside it (on-stack replacement), before any code after the loop has
// run; that code, having told the compiler nothing, sent every later call back
// out of the compiled loop.
let folded = (bundles: Bundle[]) => {
  let out = {
    by: new Map<Eid, Bundle>(),
    gone: new Set<Eid>(),
    said: new Set<Eid>(),
  }
  let { by, gone, said } = out
  for (let b of bundles) {
    let eid = b.entity.eid
    let one = by.get(eid)
    if (!one) by.set(eid, one = { entity: { eid } })
    if (!b.$quiet) said.add(eid)
    // The identity is merged rather than replaced: only the phase that created
    // it knows the `num`, and only the caller's own bundle carries the alias.
    // The first number wins, so a batch spread across several stores reads
    // the way a query over them does — a num is one store's own counter, while
    // the eid identifies the entity everywhere.
    if (b.entity.num !== undefined && one.entity.num == null) {
      one.entity = { ...one.entity, num: b.entity.num }
    }
    if (b.entity.archetype !== undefined) {
      one.entity.archetype = b.entity.archetype
    }
    if (typeof b.$alias == 'string') one.$alias = b.$alias
    if (dead(b)) gone.add(eid)
    for (let name of Object.keys(b)) {
      if (reserved(name)) continue
      let comp = b[name] as Comp | null
      let was = one[name] as Comp | null | undefined
      one[name] = comp == null ? null : was ? { ...was, ...comp } : { ...comp }
    }
  }
  return out
}

/** Accumulate unsent patches without re-reading the whole batch on each add. */
export let coalescer = (): {
  add: (bundles: Bundle[]) => void
  read: () => Bundle[]
} => {
  let clears = new Map<Eid, Bundle>()
  let values = new Map<Eid, Bundle>()
  let order = new Set<Eid>()
  let add = (bundles: Bundle[]) => {
    for (let b of bundles) {
      let eid = b.entity.eid
      order.add(eid)
      for (let [name, patch] of comps(b)) {
        if (patch == null) {
          let clear = clears.get(eid) ?? { entity: { eid } }
          clear[name] = null
          clears.set(eid, clear)
          let value = values.get(eid)
          if (value) delete value[name]
        } else {
          let value = values.get(eid) ?? { entity: { eid } }
          value[name] = { ...value[name] as Comp | undefined, ...patch }
          values.set(eid, value)
        }
      }
    }
  }
  let read = (): Bundle[] => {
    let out: Bundle[] = []
    for (let eid of order) {
      let clear = clears.get(eid)
      let value = values.get(eid)
      if (clear) out.push(clear)
      if (value && comps(value).length) out.push(value)
    }
    return out
  }
  return { add, read }
}

/** Fold unsent patches by entity and component, preserving clear-then-write. */
export let coalesced = (bundles: Bundle[]): Bundle[] => {
  let batch = coalescer()
  batch.add(bundles)
  return batch.read()
}

/**
 * The bundles, refused unless they form a batch: an array whose every
 * member is an object whose `entity` names an eid. Every door hands `apply()`
 * what arrived, and the first phase reads each bundle's eid, so the shape is
 * refused here, before anything reads it, naming the bundle by its place.
 */
export let formed = (bundles: unknown): Bundle[] => {
  if (!Array.isArray(bundles)) {
    throw new Misfit('a batch is an array of bundles')
  }
  bundles.forEach((b, i) => {
    let eid = b && typeof b == 'object' ? b.entity?.eid : undefined
    if (typeof eid != 'string' || (!eid && b.$prune !== true)) {
      throw new Misfit(
        `bundle ${i} needs an entity: {entity: {eid}} — an eid you mint, or ` +
          `'$name' to have the graph mint one`,
      )
    }
  })
  return bundles
}

/** The requests `apply()` answers itself. */
export let REQUESTS: string[] = [
  '$delete',
  '$prune',
  '$was',
  '$actor',
  '$alias',
  '$quiet',
]

/**
 * Every bundle's `$` keys, checked against what this graph can answer. The
 * refusal names the request and lists the ones it has, because a caller asking
 * for something nobody registered has the wrong idea of this graph.
 */
export let requested = (bundles: Bundle[], answered: string[]): Bundle[] => {
  let known = new Set([...REQUESTS, ...answered])
  for (let b of bundles) {
    let alien = Object.keys(b).filter((k) => k.startsWith('$') && !known.has(k))
    if (alien.length) {
      throw new Misfit(
        `unknown request${alien.length > 1 ? 's' : ''}: ${
          alien.join(', ')
        } — this graph answers ${[...known].join(', ')}`,
      )
    }
  }
  return bundles
}
