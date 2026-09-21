// A link's identity, derived from the link itself.
//
// A link entity is CONTENT-ADDRESSED, the way a blob is named by the hash of
// its bytes. Its content is the three things a link is — from, relation, to —
// so two writers who create the same link land on one entity instead of two,
// and a writer removing a link computes its id without looking it up. Direction
// is part of that content: `a cites b` and `b cites a` are two links.
//
// This is THE derivation. Every caller computes it here — the browser page that
// creates a link, the server that accepts it, the code that removes it —
// because an id computed two different ways is two different ids.

import {
  type Bundle,
  type Comp,
  comps,
  derivedEid,
  type Eid,
} from '@yaks/graph'
import type { Derive } from '@yaks/graph'

/**
 * The eid a link derives: `sha256("<from>|<relation>|<to>")` formatted as a
 * UUID (@yaks/graph's `derivedEid` — the one derivation shared by everything
 * content-addressed, so an id computed here and an id computed elsewhere are
 * the same id).
 *
 * `relation` is the name of the component stored beside `edge`, not the name a
 * query uses for it: the id is derived from what the entity actually carries.
 */
export let edgeEid = (from: Eid, relation: string, to: Eid): Eid =>
  derivedEid(`${from}|${relation}|${to}`)

/**
 * The name of the relation component in a bundle, or `undefined` when it has
 * none. `tags` is the vocabulary's component → relation-name map
 * ({@link names}); only a declared relation counts, so an ordinary component
 * stored beside the edge is not mistaken for one.
 */
export let tagOf = (
  bundle: Bundle,
  tags: Record<string, string>,
): string | undefined =>
  comps(bundle).find(([name, comp]) => comp && tags[name])?.[0]

/**
 * How the `edge` component derives its own entity id — the {@link Derive} the
 * graph calls when an edge bundle arrives under a `$alias`, so that the write
 * creating a link also learns the id it landed on.
 *
 * An INCOMPLETE link derives nothing (it returns `''`) and the entity is given
 * an ordinary generated id, at which point the {@link stated} hook rejects the
 * write and names the missing part — a far better error than a link quietly
 * identified by half of itself.
 */
export let derive =
  (tags: Record<string, string>): Derive => (comp: Comp, bundle: Bundle) => {
    let tag = tagOf(bundle, tags)
    let { from, to } = comp
    return tag && from != null && to != null
      ? edgeEid(String(from), tag, String(to))
      : ''
  }
