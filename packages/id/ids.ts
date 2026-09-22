// The id a person types, resolved to the eid it names. `T-37580` is stored
// nowhere: what is stored is the number beside the entity, and the letter is
// derived from the components the entity has (./id.ts). So resolving one is a
// read — find the entity carrying that number, and check which letters it could
// be printed with.
//
// This is a graph plugin's `address`, which @yaks/graph calls before a caller's
// ids are used, so every entry point accepts the ids people type: the MCP
// server, the HTTP `/query` endpoint, the command line. A bare number
// (`37580`) resolves too, because the number is the identity. A letter that
// disagrees with the entity's own is refused by being left out of the answer,
// and the caller's string goes on to fail as the eid it is not.

import type { Eid, Plugin } from './graph.ts'
import { parse, prefixOf } from './id.ts'
import type { Vocab } from '@yaks/vocab'

/** Resolves human ids to eids, for a graph that numbers its entities. */
export let ids = (vocab: Vocab): Plugin => {
  let letter = prefixOf(vocab)
  return {
    name: 'ids',
    address: async (tx, said) => {
      // One read for the whole list: every number asked for, as a single
      // any-of filter.
      let want = new Map<number, string[]>()
      for (let id of said) {
        let p = parse(id)
        if (p) want.set(p.num, [...want.get(p.num) ?? [], id])
      }
      let at = new Map<string, Eid>()
      if (!want.size) return at
      for (
        let b of await tx.read(`.entity.num=${[...want.keys()].join(',')}`)
      ) {
        let num = Number(b.entity.num)
        // Every letter this entity could be printed with, not only the one it
        // displays as. An entity has several kinds at once — a task is a `doc`
        // too — and a person typing `T-17` for the thing to do is right
        // whichever kind happens to win the display.
        let series = new Set(
          vocab.kinds.filter((k) => b[k]).map((k) => letter(k)),
        )
        for (let id of want.get(num) ?? []) {
          let p = parse(id)
          if (p && (!p.prefix || series.has(p.prefix))) at.set(id, b.entity.eid)
        }
      }
      return at
    },
  }
}
