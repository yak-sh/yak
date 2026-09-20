// The id a person says out loud, as the eid it names. `T-37580` is stored
// nowhere: the NUMBER beside the entity is, and the letter is derived from the
// component it wears (@yaks/id). So addressing one is a read — find the entity
// carrying that number, and check the letter it would print with.
//
// It is a plugin's `address`, the seam @yaks/graph asks before a door reads an
// id, so every door takes the id people type: `/mcp`, `/query`, the command
// line. A number with no letter (`37580`) lands too, because the number IS the
// identity; a letter that disagrees with the entity's own is refused by simply
// not answering, and the caller's word is left to fail as the eid it is not.

import type { Eid, Plugin } from '@yaks/graph'
import { parse, prefixOf } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'

/** Human ids as eids, for a graph whose store mints numbers. */
export let ids = (vocab: Vocab): Plugin => {
  let letter = prefixOf(vocab)
  return {
    name: 'ids',
    address: async (tx, said) => {
      // One read for every id on the line: the numbers, as one any-of.
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
        let series = letter(vocab.kindOf(b))
        for (let id of want.get(num) ?? []) {
          let p = parse(id)
          if (p && (!p.prefix || p.prefix == series)) at.set(id, b.entity.eid)
        }
      }
      return at
    },
  }
}
