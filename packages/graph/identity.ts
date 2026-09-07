// Identity: an entity whose own words name it.
//
// A blob is named by the hash of its bytes, an edge by the sentence it states,
// a key by the pair it carries — three packages, three derivations, one idea:
// where an entity IS its content, two writers who state the same thing must
// land on one entity rather than two. This is that idea as a DECLARATION, so
// an ordinary component gets it without a package of its own — @yaks/vocab's
// `identity` keyword (`{slug: {identity: true}}`), read here:
//
//   { entity: { eid: '$p' }, guide: { slug: 'store', brief: 'the store' } }
//
// The eid is `sha256("guide|store")` worn as a UUID, so the same file loaded
// tomorrow is the same entity, a rename is a different entity rather than a
// silent collision, and uniqueness is a fact about ids instead of a race
// somebody has to remember to declare. Nobody has to have kept an eid, and
// nobody has to invent a `$alias` that means anything.
//
// IT IS THE SAME DERIVE PATH the plugins use — `Derive` and the mint phase's
// `resolve` (alias.ts) — not a second one beside it. What is new here is only
// where the naming comes from: the vocabulary, rather than a plugin that owns
// the component. A plugin's own derive still wins, because @yaks/edge and
// @yaks/key name their entities from a TAG the bundle wears, which is more
// than a column list can say.
//
// The other half is the refusal. A derived id is only worth anything while the
// id and the value agree, so a bundle that states an identity value on some
// OTHER id is refused rather than quietly written: renaming is minting a new
// entity, never patching a column.

import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { comps } from './bundle.ts'
import type { Derive } from './alias.ts'
import { Refused } from './admit.ts'
import { sha256 } from './sha256.ts'

/**
 * The eid a sentence names: the leading 16 bytes of `sha256(sentence)`, worn
 * as a UUID — version nibble 8 (RFC 9562's custom-derivation version) and the
 * variant bits stamped, so it passes every uuid door and can never collide
 * with a randomly minted one.
 *
 * THE derivation, for everything content-addressed: @yaks/edge hashes
 * `"<from>|<relation>|<to>"`, @yaks/key `"<kind>|<value>"`, and an identity
 * `"<component>|<value>"`. An id computed two ways is two ids, so they all
 * compute it here.
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
 * The entity a component's identity names: the component, then its identity
 * values in the order the vocabulary declares them.
 *
 * ```ts
 * identityEid('guide', ['store']) // sha256('guide|store') as a uuid
 * ```
 *
 * The component's name leads the sentence so two components holding the same
 * word are two entities — a `guide` called `store` and a `page` called `store`
 * are not one thing.
 */
export let identityEid = (comp: string, values: string[]): Eid =>
  derivedEid([comp, ...values].join('|'))

// What a bundle states for one identity tuple, or nothing when it states less
// than the whole of it. A half-stated identity is not an identity: the entity
// takes an ordinary minted id and {@link identified} is what refuses it.
let statedBy = (comp: Comp, cols: string[]): string[] | undefined => {
  let out: string[] = []
  for (let col of cols) {
    let v = comp[col]
    if (v == null || v === '') return undefined
    out.push(String(v))
  }
  return out
}

// Every identity a bundle states, as [component, columns, values].
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
 * Every identity-bearing component's {@link Derive}, read off a loaded
 * vocabulary — what the mint phase consults so a bundle written under a
 * `$alias` lands on the entity its own words name.
 *
 * A component whose identity is only half stated derives nothing (it answers
 * `''`) and takes a minted id, which {@link identified} then refuses by name.
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
 * Run over the batch the mint phase has just named, it refuses two sentences
 * nothing downstream could make true — a bundle that states an identity value
 * on an entity that is not the one it names (renaming is minting, not
 * patching), and one the batch just minted that states an identity component
 * without the value that would have identified it.
 *
 * A PATCH is untouched: a bundle naming a real eid and saying nothing about
 * its identity columns is the ordinary write, and says nothing to disagree
 * with.
 */
export let identified = (bundles: Bundle[], vocab: Vocab): Bundle[] => {
  for (let b of bundles) {
    for (let [name, cols, values] of stating(b, vocab)) {
      if (!values) {
        // Only for an entity this batch NAMED: an id the caller wrote down is
        // an existing entity being patched, and a patch says what it likes.
        if (!b.$alias) continue
        throw new Refused(
          `${b.$alias} states ${name} without ${
            cols.join(', ')
          }, which is what identifies it`,
        )
      }
      let eid = identityEid(name, values)
      if (b.entity.eid != eid) {
        throw new Refused(
          `${b.entity.eid} states ${name}.${cols.join('+')} = ${
            values.join('+')
          }, which is ${eid} — an identity names the entity, so a value is ` +
            'claimed by writing it, never moved onto another id',
        )
      }
    }
  }
  return bundles
}
