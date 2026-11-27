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
import { edgeEid, type Relation } from './eid.ts'
import { EDGE } from './relations.ts'

let labelOf = (r: Relation): string => typeof r == 'string' ? r : r.label

/**
 * The bundle that creates a link: `link('p1', CITES, 'p2')`. `rel` is the
 * component stored beside `edge`, with its identity ({@link relation}). `ord`
 * is optional and behaves as a patch — passing it sets the link's position in
 * its list, leaving it out leaves any stored position alone.
 */
export let link = (
  from: Eid,
  rel: Relation,
  to: Eid,
  ord?: number,
): Bundle => ({
  entity: { eid: edgeEid(from, rel, to) },
  [EDGE]: ord === undefined ? { from, to } : { from, to, ord },
  [labelOf(rel)]: {},
})

/**
 * The bundle that deletes the link entity and its metadata. Linking the same
 * endpoints and relation later recreates its derived identity.
 */
export let unlink = (from: Eid, rel: Relation, to: Eid): Bundle => ({
  ...link(from, rel, to),
  $delete: true,
})
