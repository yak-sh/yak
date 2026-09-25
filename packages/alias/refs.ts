// The other direction: a name used where an eid is expected.
//
// Once an entity has the name `lemon-cake`, that name is accepted anywhere its
// id is — in a reference property (`comment: {target: 'lemon-cake'}`), as a
// bundle's own `entity.eid`, and by any caller that reads entities by id. The
// fleet's own store has resolved bare names alongside eids for as long as it
// has had them (src/db.ts `resolveId`); this is the same lookup without the
// ambiguity, since a name is unique in the store, so exactly one entity has it
// or none does.
//
// EIDS are checked first. An id that is an entity here means that entity, even
// if some other entity has the same string as a name. A caller who wrote an id
// down must never find their write land on a different row because a name was
// later created over it.
//
// And it takes one round trip, because a name's key entity has an id derived
// from the name (@yaks/key): the lookup is `get([the id, the id's key entity])`
// and a check of which came back. No query, no index, no scan. A value shaped
// like an id these packages generate — a UUID, a content hash — is not looked
// up at all, so ordinary eid references cost nothing.

import type { Eid, Tx } from '@yaks/graph'
import { minted, then } from '@yaks/graph'
import { ofOf } from '@yaks/key'
import { aliasEid } from './comp.ts'

/** Whether an id is worth looking up as a name — a `$alias` and an id these
 * packages generate (@yaks/graph `minted`: a UUID, a content hash) are not. */
export let wordish = (id: string): boolean =>
  !!id && !id.startsWith('$') && !minted(id)

/**
 * Resolves these ids to the eids they name. The returned map holds only the ids
 * that changed, so a caller reads it as `at.get(id) ?? id`, and an empty map
 * means every id was already an eid.
 *
 * This is the shared entry point: a graph built with this plugin asks it
 * through `graph.address(ids)` for an MCP tool that takes ids, a query that
 * names one, and every id a write names.
 */
export let addressed = (
  tx: Tx,
  ids: string[],
): Map<string, Eid> | Promise<Map<string, Eid>> => {
  let ask = [...new Set(ids.filter(wordish))]
  if (!ask.length) return new Map()
  return then(tx.get([...ask, ...ask.map(aliasEid)]), (rows) => {
    let by = new Map(rows.map((b) => [b.entity.eid, b]))
    let at = new Map<string, Eid>()
    for (let id of ask) {
      // Eids first: an id that is an entity here is that entity, name or no
      // name. Only otherwise is it looked up as a name.
      if (by.has(id)) continue
      let of = ofOf(by.get(aliasEid(id)))
      if (of) at.set(id, of)
    }
    return at
  })
}
