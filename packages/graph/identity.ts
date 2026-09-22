// Identity: an entity whose id is derived from its own data.
//
// A blob's id is the hash of its bytes, an edge's is derived from the two
// entities and the relation, a key's from the pair it holds — three packages,
// three derivations, one idea: where an entity is its content, two writers
// that write the same thing must end up with one entity rather than two. This
// file makes that idea declarative, so an ordinary component gets it without a
// package of its own — @yaks/vocab's `identity` keyword
// (`{slug: {identity: true}}`), read here:
//
//   { entity: { eid: '$p' }, guide: { slug: 'store', brief: 'the store' } }
//
// The eid is `sha256("guide|store")` formatted as a UUID, so the same file
// loaded tomorrow is the same entity, a rename produces a different entity
// rather than a silent collision, and uniqueness is a property of the id
// instead of a race somebody has to remember to guard against. Nobody has to
// have stored an eid, and nobody has to invent a meaningful `$alias`.
//
// It uses the same derivation path the plugins use — `Derive` and the mint
// phase's `resolve` (alias.ts) — not a second one beside it. The only new part
// is where the derivation comes from: the vocabulary, rather than a plugin
// that owns the component. A plugin's own `derive` still takes precedence,
// because @yaks/edge and @yaks/key derive their ids partly from the relation
// component the bundle carries, which a list of columns cannot express.
//
// The other half is the refusal. A derived id is only meaningful while the id
// and the value agree, so a bundle that writes an identity value onto some
// other id is refused rather than quietly written: renaming creates a new
// entity, it never patches a column.

import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { comps } from './bundle.ts'
import type { Derive } from './alias.ts'
import { Refused } from './admit.ts'
import { sha256 } from './sha256.ts'

/**
 * The eid derived from a string: the leading 16 bytes of `sha256(sentence)`,
 * formatted as a UUID — version nibble 8 (RFC 9562's custom-derivation
 * version) and the variant bits set, so it passes every uuid validator and can
 * never collide with a randomly generated one.
 *
 * This is the derivation for everything content-addressed: @yaks/edge hashes
 * `"<from>|<relation>|<to>"`, @yaks/key `"<kind>|<value>"`, and a declared
 * identity `"<component>|<value>"`. An id computed two different ways would be
 * two different ids, so they all compute it here.
 */
export let derivedEid = (sentence: string): Eid => {
  let h = sha256(sentence).slice(0, 32)
  let variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  let s = `${h.slice(0, 12)}8${h.slice(13, 16)}${variant}${h.slice(17)}`
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${
    s.slice(16, 20)
  }-${s.slice(20)}`
}

/**
 * The eid a component's declared identity produces: the component name,
 * followed by its identity values in the order the vocabulary declares them.
 *
 * ```ts
 * identityEid('guide', ['store']) // sha256('guide|store') as a uuid
 * ```
 *
 * The component name comes first, so two components holding the same value are
 * two different entities — a `guide` with slug `store` and a `page` with slug
 * `store` are not the same thing.
 */
export let identityEid = (comp: string, values: string[]): Eid =>
  derivedEid([comp, ...values].join('|'))

// The values a bundle supplies for one identity, or nothing when it supplies
// only some of them. A partial identity is not an identity: the entity is
// given an ordinary generated id, and {@link identified} refuses it.
let statedBy = (comp: Comp, cols: string[]): string[] | undefined => {
  let out: string[] = []
  for (let col of cols) {
    let v = comp[col]
    if (v == null || v === '') return undefined
    out.push(String(v))
  }
  return out
}

// Every identity a bundle supplies values for, as [component, columns,
// values].
let stating = (
  b: Bundle,
  vocab: Vocab,
): [string, string[], string[] | undefined][] =>
  comps(b).flatMap(([name, comp]) => {
    if (!comp) return []
    let cols = vocab.identity(name)
    return cols.length
      ? [[name, cols, statedBy(comp as Comp, cols)] as [
        string,
        string[],
        string[] | undefined,
      ]]
      : []
  })

/**
 * A {@link Derive} for every component that declares an identity, read off a
 * loaded vocabulary — what the mint phase consults so a bundle written under a
 * `$alias` ends up on the entity its own values identify. It is what lets a
 * seed be loaded idempotently without writing an eid: the same file loaded
 * twice writes one entity.
 *
 * A component whose identity is only partly supplied derives nothing (it
 * returns `''`) and gets a generated id, which {@link identified} then refuses
 * by name.
 */
export let identities = (vocab: Vocab): Record<string, Derive> => {
  let out: Record<string, Derive> = {}
  for (let name of vocab.all) {
    let cols = vocab.identity(name)
    if (!cols.length) continue
    out[name] = (comp: Comp) => {
      let values = statedBy(comp, cols)
      return values ? identityEid(name, values) : ''
    }
  }
  return out
}

/**
 * The other half: an id and the value it was derived from must agree.
 *
 * Run over the change the mint phase has just assigned ids to, it refuses two
 * things nothing downstream could make true — a bundle that writes an identity
 * value onto an entity other than the one that value identifies (renaming
 * creates a new entity, it does not patch), and a bundle this change just
 * created that writes an identity component without the values that would have
 * identified it.
 *
 * An ordinary PATCH is untouched: a bundle naming a real eid and saying
 * nothing about its identity columns is the normal case, and contains nothing
 * that could disagree.
 */
export let identified = (bundles: Bundle[], vocab: Vocab): Bundle[] => {
  for (let b of bundles) {
    for (let [name, cols, values] of stating(b, vocab)) {
      if (!values) {
        // Only for an entity this change created: an id the caller supplied
        // names an existing entity being patched, and a patch may write
        // whatever it likes.
        if (!b.$alias) continue
        throw new Refused(
          `${b.$alias} writes ${name} without ${
            cols.join(', ')
          }, which is what identifies it`,
        )
      }
      let eid = identityEid(name, values)
      if (b.entity.eid != eid) {
        throw new Refused(
          `${b.entity.eid} writes ${name}.${cols.join('+')} = ${
            values.join('+')
          }, which identifies ${eid} — an identity names the entity, so a ` +
            'value is claimed by writing it, never moved onto another id',
        )
      }
    }
  }
  return bundles
}
