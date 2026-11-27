// Aliases: how a batch refers to an entity it is about to create, before it
// knows the entity's id. A bundle's `entity.eid` may be an alias — any id
// starting with `$` — and every reference to that alias elsewhere in the same
// batch points at the same entity:
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
// reference that is itself an alias (an edge to an entity this same batch is
// creating). Each pass resolves whatever has no unresolved alias left beneath
// it; a batch whose aliases only depend on each other is a cycle and is
// refused, since no set of ids could satisfy it.
//
// Each resolved bundle keeps the alias it was written under, as `$alias`, so a
// caller reading the returned batch learns which id each alias became,
// without a second response channel.

import { after, groupBy } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { composed, comps, dead } from './bundle.ts'
import { Refused } from './errors.ts'

/** Whether an id is an alias — a name for an entity whose id the graph picks. */
export let isAlias = (eid: Eid): boolean => eid.startsWith('$')

/**
 * How a content-addressed component derives its entity's id: the component's
 * properties (with any aliases in them already resolved) in, the entity's id
 * out. A blob hashes its bytes; an edge hashes its two endpoints and its
 * relation.
 */
export type Derive = ((comp: Comp, bundle: Bundle) => Eid) & {
  /** Legacy address of the same fact while a store can hold either shape. */
  former?: (comp: Comp, bundle: Bundle) => Eid
}

type Held = (eids: Eid[], components: string[]) => Bundle[] | Promise<Bundle[]>
type Choice = { name: Eid; current: Eid; former: Eid; comp: string }

let choice = (
  b: Bundle,
  derive: Record<string, Derive>,
  alias: boolean,
): Choice | undefined => {
  let by = comps(b).find(([name, comp]) => comp && derive[name])
  if (!by) return undefined
  let deriving = derive[by[0]]
  let current = deriving(by[1] as Comp, b)
  let name = b.entity.eid
  if (!current) return undefined
  let former = deriving.former?.(by[1] as Comp, b) ?? ''
  if (alias || name == current || name == former) {
    return { name, current, former, comp: by[0] }
  }
}

let choose = (
  choices: Choice[],
  at: Map<Eid, Eid>,
  pending: Map<Eid, Eid>,
  held?: Held,
) => {
  let pairs = held ? choices.filter(({ former }) => former) : []
  let pick = (rows: Bundle[]) => {
    let found = new Map(rows.map((b) => [b.entity.eid, b]))
    for (let { name, current, former, comp } of choices) {
      let a = found.get(current), b = found.get(former)
      let eid = a?.[comp] != null
        ? current
        : b?.[comp] != null
        ? former
        : a && dead(a)
        ? current
        : b && dead(b)
        ? former
        : pending.get(current) ?? current
      if (eid != name) at.set(name, eid)
    }
  }
  return pairs.length
    ? after(
      held!(
        [...new Set(pairs.flatMap((c) => [c.current, c.former]))],
        [...new Set(pairs.map((c) => c.comp))],
      ),
      pick,
    )
    : pick([])
}

type References = Pick<Vocab, 'def'>

let reference = (vocab: References, name: string, prop: string) =>
  vocab.def(name)?.properties?.[prop]?.ref != null

// The aliases a bundle references, through its reference properties.
let pointsAt = (
  b: Bundle,
  vocab: References,
): Eid[] =>
  comps(b).flatMap(([name, comp]) =>
    Object.entries(comp ?? {}).flatMap(([prop, val]) =>
      typeof val == 'string' && isAlias(val) && reference(vocab, name, prop)
        ? [val]
        : []
    )
  )

// One bundle with every id in `at` rewritten to the id it maps to. `strict` is
// what the mint phase passes: an alias nothing in the batch creates means the
// batch cannot be applied, whereas an ordinary eid that is not in the map is
// simply left alone.
let rewrite = (
  b: Bundle,
  vocab: References,
  at: Map<Eid, Eid>,
  strict: boolean,
  actors = true,
): Bundle => {
  let out: Bundle = { ...b }
  if (actors && b.$actor) {
    out.$actor = { ...b.$actor }
    for (let prop of ['by', 'via'] as const) {
      let value = b.$actor[prop]
      if (value === undefined) continue
      let eid = at.get(value)
      if (eid) out.$actor[prop] = eid
      else if (strict && isAlias(value)) {
        throw new Refused(
          `$actor.${prop} references ${value}, which this batch does not create`,
        )
      }
    }
  }
  for (let [name, comp] of comps(b)) {
    if (!comp) continue
    let props: Comp | undefined
    for (let [prop, val] of Object.entries(comp)) {
      if (
        typeof val != 'string' || !reference(vocab, name, prop)
      ) continue
      let eid = at.get(val)
      if (!eid) {
        if (strict && isAlias(val)) {
          throw new Refused(
            `${name}.${prop} references ${val}, which this batch does not ` +
              `create`,
          )
        }
        continue
      }
      props = { ...(props ?? comp), [prop]: eid }
    }
    if (props) out[name] = props
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
  vocab: References,
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
 * batch to use it. An ordinary entity gets a fresh id from `mint`; a
 * component with a `derive` supplies its own. The returned bundles carry the
 * alias they were written under as `$alias`.
 */
export function resolve(
  bundles: Bundle[],
  vocab: Vocab,
  derive: Record<string, Derive>,
  mint: () => Eid,
): Bundle[]
export function resolve(
  bundles: Bundle[],
  vocab: Vocab,
  derive: Record<string, Derive>,
  mint: () => Eid,
  held: Held | undefined,
): Bundle[] | Promise<Bundle[]>
export function resolve(
  bundles: Bundle[],
  vocab: Vocab,
  derive: Record<string, Derive>,
  mint: () => Eid,
  held?: Held,
): Bundle[] | Promise<Bundle[]> {
  // One alias may appear on several bundles (a doc in one, a book in
  // another); they are one entity, so they are resolved together.
  let groups = groupBy(
    bundles.filter((b) => isAlias(b.entity.eid)),
    (b) => b.entity.eid,
  )
  let at = new Map<Eid, Eid>()
  let explicit = held
    ? bundles.flatMap((b) => {
      if (isAlias(b.entity.eid) || b.$prune) return []
      if (!comps(b).some(([n, c]) => c && derive[n]?.former)) return []
      let picked = choice(b, derive, false)
      return picked?.former ? [picked] : []
    })
    : []
  // No alias or transition between addresses applies to most writes.
  if (
    !groups.size && !explicit.length &&
    !bundles.some((b) =>
      pointsAt(b, vocab).length || Object.values(b.$actor ?? {}).some(isAlias)
    )
  ) {
    return bundles
  }
  let left = [...groups.keys()]
  // An explicit eid also supplies an address for aliases of the same fact.
  let pending = new Map<Eid, Eid>()
  for (let { current, name } of explicit) {
    if (name == current || !pending.has(current)) pending.set(current, name)
  }
  let advance = (): Bundle[] | Promise<Bundle[]> => {
    while (left.length) {
      // Everything whose alias references are all resolved can be given an id
      // now.
      let ready = new Set(
        left.filter((alias) =>
          groups.get(alias)!.every((b) =>
            pointsAt(b, vocab).every((a) => at.has(a))
          )
        ),
      )
      if (!ready.size) {
        throw new Refused(
          `aliases depend on each other and cannot be resolved: ${
            left.join(', ')
          }`,
        )
      }
      let choices: Choice[] = []
      for (let alias of ready) {
        let facts = groups.get(alias)!.map((b) =>
          rewrite(b, vocab, at, true, false)
        )
        let picked = facts.map((b) => choice(b, derive, true)).find(Boolean)
        if (!picked && facts.length > 1) {
          let together = composed(facts)[0]
          if (together) picked = choice(together, derive, true)
        }
        if (picked) choices.push(picked)
        else at.set(alias, mint())
      }
      let picked = choose(choices, at, pending, held)
      left = left.filter((alias) => !ready.has(alias))
      if (picked) return picked.then(advance)
    }
    return bundles.map((b) => {
      let out = rewrite(b, vocab, at, true)
      let name = b.entity.eid
      let eid = at.get(name)
      if (!eid) return out
      let entity = { ...out.entity, eid }
      return isAlias(name)
        ? { ...out, entity, $alias: name }
        : { ...out, entity }
    })
  }
  return after(choose(explicit, at, pending, held), advance)
}
