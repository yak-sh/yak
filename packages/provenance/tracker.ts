// Live value attribution, opt-in: a store that wants it composes this tracker
// (@yaks/platform's `yak/authorship` for app stores). It is not a facet, so a
// graph that lists this package gets the stamps alone.
import { after } from '@yaks/fp'
import type { Bundle, Plugin, Tracker, Tx } from '@yaks/graph'
import { writers } from '@yaks/graph/provenance'
import type { Vocab } from '@yaks/vocab'
import { retained } from './authorship.ts'

/** Retain value writers inside the same transaction as the values. */
export let authorship = (vocab: Vocab): Plugin => ({
  name: '@yaks/provenance',
  admission: () => true,
  wants: (bundles) => [{ eids: bundles.map((b) => b.entity.eid) }],
  track: (tx, found, context): Tracker => {
    let before = new Map<string, Bundle | undefined>()
    let deleted = new Set<string>()
    let writer = writers(context?.bundles ?? [])
    let remember = (eids: string[]) => {
      let missing = [...new Set(eids)].filter((eid) => !before.has(eid))
      let unknown = missing.filter((eid) => found(eid) === undefined)
      return after(unknown.length ? tx.get(unknown) : [], (rows) => {
        let read = new Map(rows.map((b) => [b.entity.eid, b]))
        for (let eid of missing) before.set(eid, found(eid) ?? read.get(eid))
      })
    }
    let wrapped: Tx = {
      ...tx,
      patch: (bundles) =>
        after(
          remember(bundles.map((b) => b.entity.eid)),
          () => tx.patch(bundles),
        ),
      remove: (entities) => {
        for (let e of entities) deleted.add(e.eid)
        return tx.remove(entities)
      },
    }
    return {
      tx: wrapped,
      flush: (bundles) => {
        let eids = [...before.keys()].filter((eid) => !deleted.has(eid))
        if (!eids.length) return bundles
        return after(tx.get(eids), (rows) => {
          // Attribution is this facet's own bookkeeping: quiet, so it rides on
          // an entity the write already returns and never adds one to the
          // answer (@yaks/graph `composed`).
          let patches = rows.map((row): Bundle => ({
            entity: row.entity,
            $quiet: true,
            authorship: {
              fields: retained(
                before.get(row.entity.eid),
                row,
                writer(row.entity.eid),
                vocab,
              ),
            },
          }))
          before.clear()
          return after(tx.patch(patches), () => [...bundles, ...patches])
        })
      },
    }
  },
})
