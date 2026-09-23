// The other direction: a name used where an eid is expected.
//
// Once an entity has the name `lemon-cake`, that name is accepted anywhere its
// id is — in a reference column (`comment: {target: 'lemon-cake'}`), as a
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

import type { Bundle, Eid, Hook, Tx } from '@yaks/graph'
import { comps, substitute, then } from '@yaks/graph'
import { minted } from '@yaks/graph'
import { ofOf } from '@yaks/key'
import type { Vocab } from '@yaks/vocab'
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
 * This is the shared entry point: an MCP tool that takes ids, a query that
 * names one, and the hook below all call it. A graph built with this plugin
 * exposes it as `graph.address(ids)`.
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

// Every id mentioned in a list of bundles: the entity each bundle is about, and
// whatever its reference columns point at.
let spoken = (bundles: Bundle[], vocab: Vocab): string[] => {
  let out: string[] = bundles.map((b) => b.entity.eid)
  for (let b of bundles) {
    for (let [name, comp] of comps(b)) {
      for (let [prop, val] of Object.entries(comp ?? {})) {
        if (
          typeof val == 'string' && vocab.prop(name, prop)?.category == 'ref'
        ) out.push(val)
      }
    }
  }
  return out
}

/**
 * The `normalize` hook that lets a write address entities by name: every id in
 * it that is some entity's name is replaced by that entity's eid, both as a
 * bundle's own id and in every reference column. Registered by
 * {@link aliases}; exported on its own for a graph that wants it without the
 * vocabulary.
 *
 * It runs before `mint`, so a `$alias` is left alone — no entity has a name
 * starting with `$` — and every id the rest of `apply()` writes against is an
 * eid.
 */
export let pointed = (vocab: Vocab): Hook => (bundles, tx) => {
  let ids = spoken(bundles, vocab).filter(wordish)
  if (!ids.length) return bundles
  return then(addressed(tx, ids), (at) => substitute(bundles, vocab, at))
}
