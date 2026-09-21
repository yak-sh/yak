// The rejection: an incomplete link is not a link.
//
// A link is three things — an endpoint, a relation, an endpoint — and any two
// of them mean nothing. A bundle holding an edge component with no relation
// beside it would be stored as a row nothing can interpret; one missing an
// endpoint would point nowhere. Both are caught here, in the `mint` phase,
// which runs after the graph has resolved every `$alias` — so the error can
// name the entity it is about, and an endpoint written as an alias is already
// the id it resolved to.
//
// A bundle naming NEITHER endpoint is a patch of a link that already exists
// (setting `ord`, say) and is left alone: it does not create a link, so it
// cannot create half of one.
//
// Every bundle in the write is read before any check, because one entity may
// arrive as several bundles — the edge component in one, its relation component
// in another — and together they are one link.

import type { Bundle, Comp, Eid, Hook } from '@yaks/graph'
import { comps, Refused } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { EDGE, names } from './relations.ts'
import { tagOf } from './eid.ts'

// Every bundle in the write merged per entity, so a link spread over several
// of them is checked as the one link it is.
let gathered = (bundles: Bundle[]): Map<Eid, Bundle> => {
  let out = new Map<Eid, Bundle>()
  for (let b of bundles) {
    let at = out.get(b.entity.eid) ?? { entity: b.entity }
    for (let [name, comp] of comps(b)) {
      let had = at[name] as Comp | null | undefined
      at[name] = comp == null ? null : { ...(had ?? {}), ...comp }
    }
    out.set(b.entity.eid, at)
  }
  return out
}

/**
 * The `mint` hook that rejects an incomplete link, naming what is missing.
 * Registered by the {@link plugin}; exported on its own for a graph that wants
 * the check without the rest.
 */
export let stated = (vocab: Vocab): Hook => {
  let tags = names(vocab)
  let known = Object.values(tags).sort()
  return (bundles) => {
    for (let [eid, b] of gathered(bundles)) {
      let edge = b[EDGE] as Record<string, unknown> | null | undefined
      // no link created here (a patch, or a bundle about something else)
      if (!edge || (edge.from == null && edge.to == null)) continue
      for (let end of ['from', 'to']) {
        if (edge[end] == null) {
          throw new Refused(`edge ${eid} has no \`${end}\` end`)
        }
      }
      if (!tagOf(b, tags)) {
        throw new Refused(
          `edge ${eid} states no relation — an edge wears a relation tag ` +
            `beside edge{from, to}${
              known.length ? ` (this vocabulary knows ${known.join(', ')})` : ''
            }`,
        )
      }
    }
    return bundles
  }
}
