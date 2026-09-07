// An edge's identity: the sentence it states.
//
// An edge entity is CONTENT-ADDRESSED, the way a blob is named by the hash of
// its bytes. Its content is the sentence — from, relation, to — so two writers
// who state the same link land on one entity instead of two, and a writer who
// wants to take a link back names it without looking it up. Direction is part
// of the sentence: `a cites b` and `b cites a` are two edges.
//
// This is THE derivation. Every door computes it here — the page that mints a
// link, the server that admits it, the reader that unlinks — because an id
// computed two ways is two ids.

import {
  type Bundle,
  type Comp,
  comps,
  derivedEid,
  type Eid,
} from '@yaks/graph'
import type { Derive } from '@yaks/graph'

/**
 * The eid a sentence names: `sha256("<from>|<relation>|<to>")` worn as a UUID
 * (@yaks/graph `derivedEid` — the one derivation everything content-addressed
 * shares, so an id computed here and an id computed there are one id).
 *
 * `relation` is the TAG component the edge wears, not the name a query says it
 * by: the entity is named by what it carries.
 */
export let edgeEid = (from: Eid, relation: string, to: Eid): Eid =>
  derivedEid(`${from}|${relation}|${to}`)

/**
 * The relation tag a bundle wears, or nothing when it states none. `tags` is
 * the vocabulary's tag → name map ({@link names}); only a declared relation
 * counts, so an ordinary component riding beside the edge is not mistaken for
 * one.
 */
export let tagOf = (
  bundle: Bundle,
  tags: Record<string, string>,
): string | undefined =>
  comps(bundle).find(([name, comp]) => comp && tags[name])?.[0]

/**
 * How the `edge` component names its own entity — the {@link Derive} a graph
 * consults when an edge bundle arrives under a `$alias`, so the batch that
 * states a link also learns the id it landed on.
 *
 * An INCOMPLETE sentence derives nothing (it answers `''`) and the entity takes
 * an ordinary minted id, at which point the {@link stated} hook refuses the
 * batch and says which part was missing — a much better error than an edge
 * quietly named after half of itself.
 */
export let derive =
  (tags: Record<string, string>): Derive => (comp: Comp, bundle: Bundle) => {
    let tag = tagOf(bundle, tags)
    let { from, to } = comp
    return tag && from != null && to != null
      ? edgeEid(String(from), tag, String(to))
      : ''
  }
