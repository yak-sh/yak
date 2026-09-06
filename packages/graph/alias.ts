// Aliases: a batch that names an entity it is about to create, without knowing
// its id yet. A bundle's `entity.eid` may be an ALIAS — any id starting with
// `$` — and every reference to that alias elsewhere in the same batch points
// at the same entity:
//
//   [{ entity: { eid: '$dune' }, doc: { title: 'Dune' } },
//    { entity: { eid: 'r1' }, review: { stars: 5, book: '$dune' } }]
//
// The alias means THE SERVER PICKS THE ID. For an ordinary entity that is a
// fresh client-style uuid. For a CONTENT-ADDRESSED one it is derived from the
// content itself — a blob is named by the hash of its bytes, an edge by the
// sentence it states — because two writers who state the same fact must land
// on the same entity rather than two. Which components are content-addressed
// is not this file's business: a plugin brings a `derive` for the component it
// owns, and the graph asks.
//
// Resolution is a small fixpoint, because a derived id may depend on a
// reference that is itself an alias (an edge to an entity this batch is also
// minting). Each pass resolves whatever has no unresolved alias left under it;
// a batch whose aliases only depend on each other is a cycle and is refused,
// since no id could satisfy it.
//
// The resolved bundle keeps the alias it was named by, as `$alias`, so a
// caller reading the returned batch learns the mapping without a second
// channel.

import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { comps } from './bundle.ts'
import { Refused } from './admit.ts'

/** Whether an id is an alias — a name for an entity whose id the graph picks. */
export let isAlias = (eid: Eid): boolean => eid.startsWith('$')

/**
 * How a content-addressed component names its entity: the component's columns
 * (with any aliases in them already resolved) in, the entity's id out. A blob
 * hashes its bytes; an edge hashes the sentence it states.
 */
export type Derive = (comp: Comp, bundle: Bundle) => Eid

// The alias values a bundle points at, through its reference columns.
let pointsAt = (b: Bundle, vocab: Vocab): Eid[] =>
  comps(b).flatMap(([name, comp]) =>
    Object.entries(comp ?? {}).flatMap(([prop, val]) =>
      typeof val == 'string' && isAlias(val) &&
        vocab.column(name, prop)?.category == 'ref'
        ? [val]
        : []
    )
  )

// One bundle with every id in `at` rewritten to the id it stands for. `strict`
// is the mint phase's own reading: an ALIAS nothing named is a batch that
// cannot land, where an ordinary eid nobody renamed is simply left alone.
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
        typeof val != 'string' || vocab.column(name, prop)?.category != 'ref'
      ) continue
      let eid = at.get(val)
      if (!eid) {
        if (strict && isAlias(val)) {
          throw new Refused(
            `${name}.${prop} names ${val}, which this batch does not mint`,
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
 * The other half of {@link resolve}, on its own: every entity named by one of
 * these ids, and every reference to one, rewritten to the id it stands for.
 * Anything the map does not name is left exactly alone.
 *
 * It is exported for a plugin that names entities of its OWN in the mint phase.
 * {@link https://jsr.io/@yaks/alias | @yaks/alias} is the one: a bundle
 * carrying a name some entity already holds is a patch OF that entity, so the
 * id this phase just minted has to give way to the holder's — in the bundle
 * itself and in everything pointing at it — which is this function.
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
 * The mint phase: give every alias in the batch a real id, and rewrite the
 * batch to use it. An ordinary entity gets a fresh one from `mint`; a
 * component with a `derive` names its own. The returned bundles carry their
 * alias as `$alias`.
 */
export let resolve = (
  bundles: Bundle[],
  vocab: Vocab,
  derive: Record<string, Derive>,
  mint: () => Eid,
): Bundle[] => {
  // One alias may be spelled across several bundles (a doc here, a book
  // there); they are one entity, so they are named together.
  let groups = new Map<Eid, Bundle[]>()
  for (let b of bundles) {
    if (!isAlias(b.entity.eid)) continue
    groups.set(b.entity.eid, [...(groups.get(b.entity.eid) ?? []), b])
  }
  // Nothing named, nothing pointing: the common batch, left exactly alone.
  if (!groups.size && !bundles.some((b) => pointsAt(b, vocab).length)) {
    return bundles
  }
  let at = new Map<Eid, Eid>()
  let left = [...groups.keys()]
  while (left.length) {
    // Everything whose alias references are all resolved can be named now.
    let ready = left.filter((alias) =>
      groups.get(alias)!.every((b) =>
        pointsAt(b, vocab).every((a) => at.has(a))
      )
    )
    if (!ready.length) {
      throw new Refused(
        `aliases depend on each other and cannot be named: ${left.join(', ')}`,
      )
    }
    for (let alias of ready) {
      // A content-addressed component names the entity; anything else takes a
      // fresh id. The whole group is searched, so it does not matter which
      // bundle in the batch carried the naming component.
      let named: Eid | undefined
      for (let b of groups.get(alias)!) {
        let full = rewrite(b, vocab, at, true)
        let by = comps(full).find(([name, comp]) => comp && derive[name])
        if (by) named = derive[by[0]](by[1] as Comp, full)
        if (named) break
      }
      at.set(alias, named ?? mint())
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
