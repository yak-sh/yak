// A key's identity: the kind and the value.
//
// A key entity is content-addressed, the way an edge's id is derived from the
// two entities it links and a blob's from the hash of its bytes. Here the
// content is the pair — kind, value — so two writers giving the same value land
// on one entity, a writer retiring a value can name its entity without a
// lookup, and the uniqueness of a value within its kind is a fact about ids
// rather than a constraint somebody has to remember to declare.
//
// This function is the only place the derivation is written, because an id
// computed two ways is two ids.

import {
  type Bundle,
  type Comp,
  comps,
  type Derive,
  derivedEid,
  type Eid,
} from '@yaks/graph'
import { VALUE } from './comp.ts'

/**
 * The eid a value lands on: `sha256("<kind>|<value>")` formatted as a UUID
 * (@yaks/graph `derivedEid` — the one derivation every content-addressed
 * component shares, so an id computed here and an id computed elsewhere are the
 * same id).
 *
 * `kind` is the tag component the key carries, not the name a query uses for
 * it: the id is derived from what the entity carries.
 */
export let keyEid = (kind: string, value: string): Eid =>
  derivedEid(`${kind}|${value}`)

/**
 * The kind tag a bundle carries, or nothing when it carries none. `tags` is the
 * vocabulary's tag → name map ({@link names}); only a declared kind counts, so
 * an ordinary component stored beside the key is not mistaken for one.
 */
export let tagOf = (
  bundle: Bundle,
  tags: Record<string, string>,
): string | undefined =>
  comps(bundle).find(([name, comp]) => comp && tags[name])?.[0]

/**
 * How the `key` component derives its own entity's id — the {@link Derive} a
 * graph calls when a key bundle arrives under a `$alias`, so the write that
 * claims a value also learns the id it landed on.
 *
 * A key missing its kind or its value derives nothing (it returns `''`) and the
 * entity takes an ordinary minted id, at which point the {@link stated} hook
 * refuses the write and reports which part was missing — a much better error
 * than a key whose id was derived from half of itself.
 */
export let derive =
  (tags: Record<string, string>): Derive => (comp: Comp, bundle: Bundle) => {
    let tag = tagOf(bundle, tags)
    let value = comp[VALUE]
    return tag && typeof value == 'string' && value ? keyEid(tag, value) : ''
  }
