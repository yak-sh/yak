// Aliases: how a change refers to an entity it is about to create, before it
// knows the entity's id. A bundle's `entity.eid` may be an alias — any id
// starting with `$` — and every reference to that alias elsewhere in the same
// change points at the same entity:
//
//   [{ entity: { eid: '$dune' }, doc: { title: 'Dune' } },
//    { entity: { eid: 'r1' }, review: { stars: 5, book: '$dune' } }]
//
// An alias means the server picks the ID. For an ordinary entity that is a
// freshly generated uuid. For a content-addressed one it is derived from the
// content itself — a blob's id is the hash of its bytes, an edge's is derived
// from the two entities and the relation — because two writers writing the
// same fact must end up with one entity rather than two. Which components are
// content-addressed is not this file's concern: a plugin supplies a `derive`
// for the component it owns, and the graph calls it.
//
// Resolution is a small fixpoint, because a derived id may depend on a
// reference that is itself an alias (an edge to an entity this same change is
// creating). Each pass resolves whatever has no unresolved alias left beneath
// it; a change whose aliases only depend on each other is a cycle and is
// refused, since no set of ids could satisfy it.
//
// Each resolved bundle keeps the alias it was written under, as `$alias`, so a
// caller reading the returned change learns which id each alias became,
// without a second response channel.

import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { comps } from './bundle.ts'
import { Refused } from './admit.ts'

/** Whether an id is an alias — a name for an entity whose id the graph picks. */
export let isAlias = (eid: Eid): boolean => eid.startsWith('$')

/**
 * How a content-addressed component derives its entity's id: the component's
 * columns (with any aliases in them already resolved) in, the entity's id out.
 * A blob hashes its bytes; an edge hashes its two endpoints and its relation.
 */
export type Derive = (comp: Comp, bundle: Bundle) => Eid

// The aliases a bundle references, through its reference columns.
let pointsAt = (b: Bundle, vocab: Vocab): Eid[] =>
  comps(b).flatMap(([name, comp]) =>
    Object.entries(comp ?? {}).flatMap(([prop, val]) =>
      typeof val == 'string' && isAlias(val) &&
        vocab.prop(name, prop)?.category == 'ref'
        ? [val]
        : []
    )
  )

// One bundle with every id in `at` rewritten to the id it maps to. `strict` is
// what the mint phase passes: an alias nothing in the change creates means the
// change cannot be applied, whereas an ordinary eid that is not in the map is
// simply left alone.
let rewrite = (
  b: Bundle,
  vocab: Vocab,
  at: Map<Eid, Eid>,
  strict: boolean,
): Bundle => {
  let out: Bundle = { ...b }
  for (let [name, comp] of comps(b)) {
    if (!comp) continue
    let cols: Comp | undefined
    for (let [prop, val] of Object.entries(comp)) {
      if (
        typeof val != 'string' || vocab.prop(name, prop)?.category != 'ref'
      ) continue
      let eid = at.get(val)
      if (!eid) {
        if (strict && isAlias(val)) {
          throw new Refused(
            `${name}.${prop} references ${val}, which this change does not ` +
              `create`,
          )
        }
        continue
      }
      cols = { ...(cols ?? comp), [prop]: eid }
    }
    if (cols) out[name] = cols
  }
  return out
}

/**
 * The second half of {@link resolve}, usable on its own: every entity
 * identified by one of these ids, and every reference to one, rewritten to the
 * id it maps to. Anything the map does not mention is left exactly alone.
 *
 * It is exported for a plugin that resolves ids of its own.
 * {@link https://jsr.io/@yaks/key | @yaks/key} is one: a bundle claiming a
 * value some entity already holds is really a patch of that entity, so the id
 * the mint phase just picked has to be replaced by the existing holder's — in
 * the bundle itself and in everything referencing it — which is what this
 * function does.
 */
export let substitute = (
  bundles: Bundle[],
  vocab: Vocab,
  at: Map<Eid, Eid>,
): Bundle[] =>
  at.size
    ? bundles.map((b) => {
      let out = rewrite(b, vocab, at, false)
      let eid = at.get(b.entity.eid)
      return eid ? { ...out, entity: { ...out.entity, eid } } : out
    })
    : bundles

/**
 * The mint phase: give every alias in the change a real id, and rewrite the
 * change to use it. An ordinary entity gets a fresh id from `mint`; a
 * component with a `derive` supplies its own. The returned bundles carry the
 * alias they were written under as `$alias`.
 */
export let resolve = (
  bundles: Bundle[],
  vocab: Vocab,
  derive: Record<string, Derive>,
  mint: () => Eid,
): Bundle[] => {
  // One alias may appear on several bundles (a doc in one, a book in
  // another); they are one entity, so they are resolved together.
  let groups = new Map<Eid, Bundle[]>()
  for (let b of bundles) {
    if (!isAlias(b.entity.eid)) continue
    groups.set(b.entity.eid, [...(groups.get(b.entity.eid) ?? []), b])
  }
  // No aliases, and nothing referencing one: the common case, left exactly
  // alone.
  if (!groups.size && !bundles.some((b) => pointsAt(b, vocab).length)) {
    return bundles
  }
  let at = new Map<Eid, Eid>()
  let left = [...groups.keys()]
  while (left.length) {
    // Everything whose alias references are all resolved can be given an id
    // now.
    let ready = left.filter((alias) =>
      groups.get(alias)!.every((b) =>
        pointsAt(b, vocab).every((a) => at.has(a))
      )
    )
    if (!ready.length) {
      throw new Refused(
        `aliases depend on each other and cannot be resolved: ${
          left.join(', ')
        }`,
      )
    }
    for (let alias of ready) {
      // A content-addressed component derives the entity's id; anything else
      // gets a fresh one. The whole group is searched, so it does not matter
      // which bundle in the change carried the deriving component.
      let named: Eid | undefined
      for (let b of groups.get(alias)!) {
        let full = rewrite(b, vocab, at, true)
        let by = comps(full).find(([name, comp]) => comp && derive[name])
        if (by) named = derive[by[0]](by[1] as Comp, full)
        if (named) break
      }
      // `||`, not `??`: a component that could not derive an id returns the
      // empty string (an edge missing an endpoint, a partly supplied
      // identity), and the documented meaning of that is a freshly generated
      // id — which the hook that owns the component then refuses by name. Used
      // as the eid, an empty string would create an entity with no id at
      // all.
      at.set(alias, named || mint())
    }
    left = left.filter((alias) => !at.has(alias))
  }
  return bundles.map((b) => {
    let out = rewrite(b, vocab, at, true)
    let eid = at.get(b.entity.eid)
    return eid
      ? { ...out, entity: { ...out.entity, eid }, $alias: b.entity.eid }
      : out
  })
}
