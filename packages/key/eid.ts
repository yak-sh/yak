// A key's identity: the kind and the value.
//
// A key entity is CONTENT-ADDRESSED, the way an edge is named by the sentence
// it states and a blob by the hash of its bytes. Its content is the pair —
// kind, value — so two writers who state the same value land on one
// entity, a writer who wants to retire it names it without a lookup, and the
// uniqueness of a value within its kind is a fact about ids rather than a
// constraint somebody has to remember to declare.
//
// This is THE derivation. Every door computes it here, because an id computed
// two ways is two ids.

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
 * The eid a value lands on: `sha256("<kind>|<value>")` worn as a UUID
 * (@yaks/graph `derivedEid` — the one derivation everything content-addressed
 * shares, so an id computed here and an id computed there are one id).
 *
 * `kind` is the TAG component the key wears, not the name a query says it
 * by: the entity is named by what it carries.
 */
export let keyEid = (kind: string, value: string): Eid =>
  derivedEid(`${kind}|${value}`)

/**
 * The kind tag a bundle wears, or nothing when it wears none. `tags` is
 * the vocabulary's tag → name map ({@link names}); only a declared kind
 * counts, so an ordinary component riding beside the key is not mistaken for
 * one.
 */
export let tagOf = (
  bundle: Bundle,
  tags: Record<string, string>,
): string | undefined =>
  comps(bundle).find(([name, comp]) => comp && tags[name])?.[0]

/**
 * How the `key` component names its own entity — the {@link Derive} a graph
 * consults when a key bundle arrives under a `$alias`, so the batch that states
 * a value also learns the id it landed on.
 *
 * A key missing its kind or its value derives nothing (it answers `''`)
 * and the entity takes an ordinary minted id, at which point the {@link stated}
 * hook refuses the batch and says which part was missing — a much better error
 * than a key quietly named after half of itself.
 */
export let derive =
  (tags: Record<string, string>): Derive => (comp: Comp, bundle: Bundle) => {
    let tag = tagOf(bundle, tags)
    let value = comp[VALUE]
    return tag && typeof value == 'string' && value ? keyEid(tag, value) : ''
  }
