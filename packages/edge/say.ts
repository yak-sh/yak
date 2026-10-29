// Creating a link, and removing it.
//
// A link is written the way everything else is — as a bundle. Its id comes from
// its own endpoints and relation, so it needs no id from anywhere else:
// `link()` derives it, and a write containing the same link twice writes one
// entity.
//
// Removing a link deletes its entity, including any facts attached to it.
// Saying the same link again recreates it at the same derived identity.

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
 * The bundle that deletes the link entity and its metadata. Linking the same
 * endpoints and relation later recreates its derived identity.
 */
export let unlink = (from: Eid, relation: string, to: Eid): Bundle => ({
  entity: { eid: edgeEid(from, relation, to) },
  $delete: true,
})
