// Creating a link, and removing it.
//
// A link is written the way everything else is — as a bundle. Its id comes from
// its own endpoints and relation, so it needs no id from anywhere else:
// `link()` derives it, and a write containing the same link twice writes one
// entity.
//
// Removing a link does NOT delete its entity. The link no longer exists, but
// the same link may be created again tomorrow, so its COMPONENTS are cleared
// and the entity id stays. An entity with no components is invisible to every
// reader; deleting it instead would tombstone an id DERIVED from the link's
// endpoints and relation, and a tombstone is permanent — `a cites b` could
// never be written again.

import type { Bundle, Eid } from '@yaks/graph'
import { edgeEid } from './eid.ts'
import { EDGE } from './relations.ts'

/**
 * The bundle that creates a link: `link('p1', 'cites', 'p2')`. `relation` is
 * the name of the component stored beside `edge`. `ord` is optional and behaves
 * as a patch — passing it sets the link's position in its list, leaving it out
 * leaves any stored position alone.
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
 * The bundle that removes that link: both components cleared, the entity left
 * in place so the same link can be created again.
 */
export let unlink = (from: Eid, relation: string, to: Eid): Bundle => ({
  entity: { eid: edgeEid(from, relation, to) },
  [EDGE]: null,
  [relation]: null,
})
