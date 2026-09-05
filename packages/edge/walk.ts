// Following links: the three questions anyone asks of a graph, answered as
// ordinary queries against a {@link Storage}.
//
//   out(p, 'cites')       what does this post cite?
//   in(p, 'cites')        who cites it?
//   reach(p, 'cites', 3)  everything within three hops of it
//
// Each is a read, not a new mechanism: an edge is a component, so "the links
// out of p" is the query `.edge.from=p` narrowed to the entities wearing the
// relation's tag. `reach` is one such query per level, which is why its depth
// is required — a walk with no cap is a graph scan wearing a friendly name.
//
// Every answer is a set of ENTITY ids, not edges: the far ends, deduplicated,
// which is what a caller almost always wanted. Reading the links themselves is
// `storage.read` with the same query.
//
// Sync in, sync out: a storage over an embedded database answers immediately
// and so does this, while an asynchronous one turns the walk into a promise.
// Nothing in between has to know which.

import { and, eq, type Input, list, present } from '@yaks/query'
import { each, type Eid, type Storage, then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { EDGE, relations } from './relations.ts'

/** Which way a walk follows a link: away from the entity, or back to it. */
export type Dir = 'out' | 'in'

/** The traversal seam, bound to one storage and vocabulary. */
export type Walk = {
  /** the entities this one links to through `relation` */
  out: (eid: Eid, relation: string) => Eid[] | Promise<Eid[]>
  /** the entities that link to this one through `relation` */
  in: (eid: Eid, relation: string) => Eid[] | Promise<Eid[]>
  /** everything within `depth` hops — the start included only if a path of at
   * least one hop leads back to it, which is what `.reaches` selects too */
  reach: (
    eid: Eid,
    relation: string,
    depth: number,
    dir?: Dir,
  ) => Eid[] | Promise<Eid[]>
}

let value = (eids: Eid[]): Input => eids.length == 1 ? eids[0] : list(...eids)

/**
 * The traversal helpers over a storage. `vocab` is the loaded vocabulary the
 * storage answers for; a relation it does not declare is refused, since the
 * alternative is an empty answer that reads like "nothing links here".
 */
export let walk = (storage: Storage, vocab: Vocab): Walk => {
  let rels = relations(vocab)
  let tagOf = (relation: string): string => {
    let tag = rels[relation]
    if (!tag) {
      throw new Error(
        `no such relation: ${relation}${
          Object.keys(rels).length
            ? ` (this vocabulary knows ${Object.keys(rels).sort().join(', ')})`
            : ''
        }`,
      )
    }
    return tag
  }

  // One level: the far ends of every edge of this relation touching `eids`.
  let hop = (eids: Eid[], relation: string, dir: Dir) => {
    let tag = tagOf(relation)
    let [here, there] = dir == 'out' ? ['from', 'to'] : ['to', 'from']
    if (!eids.length) return []
    let query = and(eq(`${EDGE}.${here}`, value(eids)), present(tag))
    return then(
      storage.read(query),
      (bundles) =>
        bundles.flatMap((b) => {
          let far = (b[EDGE] as Record<string, unknown> | undefined)?.[there]
          return typeof far == 'string' ? [far] : []
        }),
    )
  }

  let reach = (eid: Eid, relation: string, depth: number, dir: Dir = 'out') => {
    let seen = new Set<Eid>()
    let level = [eid]
    return then(
      each(
        Array.from({ length: Math.max(0, depth) }, (_, i) => i),
        null,
        () =>
          then(hop(level, relation, dir), (far) => {
            // A cycle comes back to somewhere already walked; the seen set is
            // what stops it, and the depth cap is what stops everything else.
            // The start is not in the answer for being the start — but it is
            // if a path of at least one hop leads back to it.
            level = far.filter((e) => !seen.has(e))
            for (let e of level) seen.add(e)
            return null
          }),
      ),
      () => [...seen],
    )
  }

  return {
    out: (eid, relation) => hop([eid], relation, 'out'),
    in: (eid, relation) => hop([eid], relation, 'in'),
    reach,
  }
}
