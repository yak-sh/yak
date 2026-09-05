// Saying a link, and taking it back.
//
// A link is written the way everything else is — as a bundle. The entity is the
// sentence itself, so it needs no id from anywhere: `link()` derives it, and a
// batch that states the same link twice writes one entity.
//
// Unlinking is not a DEATH. The sentence is no longer stated, and the same
// sentence may be stated again tomorrow, so its COMPONENTS go and the identity
// stays. An entity wearing nothing is invisible to every reader; deleting it
// instead would tombstone an id DERIVED from the sentence, and a tombstone is
// forever — `a cites b` could never be said again.

import type { Bundle, Eid } from '@yaks/graph'
import { edgeEid } from './eid.ts'
import { EDGE } from './relations.ts'

/**
 * The bundle that states a link: `link('p1', 'cites', 'p2')`. `relation` is the
 * tag component the edge wears. `ord` is optional and patch-shaped — naming it
 * sets the link's place in its list, leaving it out leaves any stored place
 * alone.
 */
export let link = (
  from: Eid,
  relation: string,
  to: Eid,
  ord?: number,
): Bundle => ({
  entity: { eid: edgeEid(from, relation, to) },
  [EDGE]: ord === undefined ? { from, to } : { from, to, ord },
  [relation]: {},
})

/**
 * The bundle that takes that link back: both components dropped, the identity
 * left standing so the same sentence can be stated again.
 */
export let unlink = (from: Eid, relation: string, to: Eid): Bundle => ({
  entity: { eid: edgeEid(from, relation, to) },
  [EDGE]: null,
  [relation]: null,
})
