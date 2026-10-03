// Admission rehearses ordinary mutation in memory, so ordered checks see the
// preceding patches without writing them. A query that needs those temporary
// rows requires the adapter's own derived state and an ordinary dry run.
import { after } from '@yaks/fp'
import type { Bundle, Eid, Entity } from './bundle.ts'
import { holding, merged, reached, type Snap } from './gather.ts'
import type { Tx } from './storage.ts'
import type { Vocab } from '@yaks/vocab'

/** Internal request to repeat admission through the adapter's own dry run. */
export class NeedsWrite extends Error {}

/** A temporary write boundary over one gathered transaction. Nothing reaches
 * its writer; `get` observes the temporary rows, while untouched reads retain
 * the adapter's query and binding semantics. */
export let rehearsing = (tx: Tx, vocab: Vocab, snap: Snap): Tx => {
  let rows = new Map<Eid, Bundle>()
  let held = holding(tx, vocab, snap)
  let query = () => {
    if (rows.size) throw new NeedsWrite()
  }
  return {
    ...tx,
    get: (eids, names) =>
      after(held.get(eids.filter((eid) => !rows.has(eid)), names), (found) => {
        let at = new Map(found.map((b) => [b.entity.eid, b]))
        return eids.flatMap((eid) => rows.get(eid) ?? at.get(eid) ?? [])
      }),
    read: (q, opts) => {
      query()
      return tx.read(q, opts)
    },
    ...(tx.whole
      ? {
        whole: (q, opts) => {
          query()
          return tx.whole!(q, opts)
        },
      }
      : {}),
    ...(tx.bindings
      ? {
        bindings: (matches, bundles, covers) => {
          query()
          return tx.bindings!(matches, bundles, covers)
        },
      }
      : {}),
    doom: undefined,
    patch: (bundles) => {
      let eids = reached(bundles, vocab)
      let missing = eids.filter((eid) => !rows.has(eid) && !snap.got.has(eid))
      let targets = new Set(bundles.map((b) => b.entity.eid))
      let named = missing.filter((eid) => targets.has(eid))
      let refs = missing.filter((eid) => !targets.has(eid))
      return after(
        held.get(
          [...targets].filter((eid) => !rows.has(eid) && snap.only?.has(eid)),
        ),
        () =>
          after(
            named.length ? tx.get(named) : [],
            (namedRows) =>
              after(refs.length ? tx.get(refs, []) : [], (refRows) => {
                let at = new Map(
                  [...namedRows, ...refRows].map((b) => [b.entity.eid, b]),
                )
                for (let eid of missing) snap.got.set(eid, at.get(eid) ?? null)
                if (refRows.length) {
                  snap.only ??= new Map()
                  for (let row of refRows) {
                    snap.only.set(row.entity.eid, new Set())
                  }
                }
                let born: Entity[] = []
                for (let eid of eids) {
                  if (!rows.has(eid) && !snap.got.get(eid)) {
                    let entity = { eid }
                    rows.set(eid, { entity })
                    born.push(entity)
                  }
                }
                for (let b of bundles) {
                  let eid = b.entity.eid
                  rows.set(
                    eid,
                    merged(rows.get(eid) ?? snap.got.get(eid) ?? null, b),
                  )
                }
                return born
              }),
          ),
      )
    },
    remove: () => {
      throw new NeedsWrite()
    },
    revive: (eids) => {
      for (let eid of eids) {
        let row = rows.get(eid) ?? snap.got.get(eid)
        rows.set(eid, { entity: row?.entity ?? { eid } })
      }
    },
  }
}
