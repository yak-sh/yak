// A representation is a snapshot: the URL may be cached for a year, so the
// graph must never change or delete the row that gives that URL its headers.

import { after } from '@yaks/fp'
import { type Comp, dead, type Plugin, Refused } from '@yaks/graph'
import { type Representation, represents } from './representation.ts'

export let representations = (): Plugin => ({
  name: 'representations',
  hooks: {
    precondition: (bundles, tx) => {
      let touched = bundles.filter((b) =>
        dead(b) || b.representation !== undefined
      )
      if (!touched.length) return bundles
      return after(
        tx.get(touched.map((b) => b.entity.eid), ['representation']),
        (found) => {
          let at = new Map(found.map((b) => [b.entity.eid, b]))
          for (let b of touched) {
            let old = at.get(b.entity.eid)?.representation as
              | Representation
              | undefined
            let patch = b.representation as Comp | null | undefined
            if (old && (dead(b) || patch === null)) {
              throw new Refused('a blob representation cannot be deleted')
            }
            if (
              old && patch &&
              Object.entries(patch).some(([k, v]) =>
                v !== old[k as keyof Representation]
              )
            ) {
              throw new Refused('a blob representation cannot change')
            }
            if (
              !old && patch &&
              !represents(b.entity.eid, patch as Representation)
            ) {
              throw new Refused('a blob representation must use its derived id')
            }
          }
          return bundles
        },
      )
    },
  },
})
