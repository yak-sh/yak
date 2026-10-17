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
// Live eids are checked first. An id with components and no tombstone means
// that entity, even
// if some other entity has the same string as a name. A caller who wrote an id
// down must never find their write land on a different row because a name was
// later created over it.
//
// A name's key entity has an id derived from the name (@yaks/key). Read
// that key alone first, then check for a live eid only where a key exists.
// Ordinary references do not gather the entity's computed properties just to
// resolve its name. UUIDs and content hashes are never looked up as names.

import type { Eid, ReadTx } from '@yaks/graph'
import { after } from '@yaks/fp'
import { alive } from '@yaks/graph/bundle'
import { minted } from '@yaks/graph/identity'
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
  tx: ReadTx,
  ids: string[],
): Map<string, Eid> | Promise<Map<string, Eid>> => {
  let ask = [...new Set(ids.filter(wordish))]
  if (!ask.length) return new Map()
  // Most references have no alias. Read only the key first: gathering the
  // referenced entity here would evaluate its computed properties just to
  // discover that its identity did not need resolving.
  let names = ask.map((id) => [id, aliasEid(id)] as const)
  return after(tx.get(names.map(([, key]) => key), ['key']), (keys) => {
    let by = new Map(keys.map((b) => [b.entity.eid, b]))
    let named = new Map(names.flatMap(([id, key]) => {
      let of = ofOf(by.get(key))
      return of ? [[id, of] as const] : []
    }))
    if (!named.size) return new Map<string, Eid>()
    return after(tx.get([...named.keys()]), (rows) => {
      let live = new Map(rows.map((b) => [b.entity.eid, b]))
      let at = new Map<string, Eid>()
      for (let [id, of] of named) {
        // A live eid wins. An empty identity or tombstone is only a name.
        if (alive(live.get(id))) continue
        at.set(id, of)
      }
      return at
    })
  })
}
