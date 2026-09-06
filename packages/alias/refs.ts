// The other direction: a NAME where an eid goes.
//
// Once an entity answers to `lemon-cake`, the word is worth as much as its id —
// so a reference column takes it (`comment: {target: 'lemon-cake'}`), a
// bundle's own `entity.eid` takes it, and a door that reads entities by id
// takes it. The fleet's own store has resolved bare names beside eids for as
// long as it has had them (src/db.ts `resolveId`), and this is that ladder with
// the ambiguity gone: a name is unique in the store, so there is exactly one
// holder or none.
//
// THE ORDER IS EID FIRST. An id that IS an entity here means that entity, even
// if somebody holds the same string as a name. A caller who wrote an id down
// must never find their write on a different row because a name grew over it.
//
// AND IT IS ONE ROUND TRIP, because a name addresses its own row (@yaks/key):
// the ladder is `get([the id, the id's key])` and a look at which came back. No
// query, no index, no scan. A value shaped like an id this family mints — a
// uuid, a content hash — is not asked about at all, so a batch of ordinary eid
// references costs nothing.

import type { Bundle, Eid, Hook, Tx } from '@yaks/graph'
import { comps, substitute, then } from '@yaks/graph'
import { ofOf } from '@yaks/key'
import type { Vocab } from '@yaks/vocab'
import { aliasEid } from './comp.ts'

// What an id this family mints looks like: a uuid, or the hex of a content
// hash. A name of that shape would be a strange name, and one written anyway is
// simply not looked up — the eid rung answers it.
let MINTED = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^[0-9a-f]{40,64}$/i

/** Whether an id is worth asking about as a name — a `$alias` and an id this
 * family mints are not. */
export let wordish = (id: string): boolean =>
  !!id && !id.startsWith('$') && !MINTED.test(id)

/**
 * These ids as the eids they name. The answer holds ONLY the ids that moved, so
 * a caller reads it as `at.get(id) ?? id`, and an empty answer means every id
 * was already an eid.
 *
 * This is the door's function: a tool that takes ids, a query line that names
 * one, and the hook below all ask it the same question. A graph composed with
 * this plugin answers it as `graph.address(ids)`.
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
      // The first rung: an id that is an entity here is that entity, name or
      // no name. Only then is the name it might be worth reading.
      if (by.has(id)) continue
      let of = ofOf(by.get(aliasEid(id)))
      if (of) at.set(id, of)
    }
    return at
  })
}

// Every id a batch says out loud: what each bundle is about, and what its
// reference columns point at.
let spoken = (bundles: Bundle[], vocab: Vocab): string[] => {
  let out: string[] = bundles.map((b) => b.entity.eid)
  for (let b of bundles) {
    for (let [name, comp] of comps(b)) {
      for (let [prop, val] of Object.entries(comp ?? {})) {
        if (
          typeof val == 'string' && vocab.column(name, prop)?.category == 'ref'
        ) out.push(val)
      }
    }
  }
  return out
}

/**
 * The `normalize` hook that lets a batch address entities by name: every id in
 * it that is a name somebody holds becomes that entity's eid, in the bundles'
 * own identity and in every reference column. Registered by {@link aliases};
 * exported on its own for a graph that wants it without the vocabulary.
 *
 * It runs before `mint`, so a `$alias` is untouched — nothing holds a `$` name
 * — and the ids the rest of `apply()` writes against are eids.
 */
export let pointed = (vocab: Vocab): Hook => (bundles, tx) => {
  let ids = spoken(bundles, vocab).filter(wordish)
  if (!ids.length) return bundles
  return then(addressed(tx, ids), (at) => substitute(bundles, vocab, at))
}
