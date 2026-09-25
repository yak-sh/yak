/** Transactional transcript ordering. Omit seq to append; explicit positions are
 * reserved for import and must be positive, unique integers. */
import {
  type Bundle,
  type Comp,
  type Graph,
  type Hook,
  then,
} from '@yaks/graph'
import { parse } from '@yaks/query'
import { UnknownSession } from './unknown.ts'

let entry = (b: Bundle | undefined) => b?.entry as Comp | undefined

export let sequencing: Hook = (bundles, tx) =>
  then(
    tx.get(bundles.filter((b) => b.entry).map((b) => b.entity.eid)),
    (existing) => {
      let groups = new Map<string, Bundle[]>()
      for (let b of bundles) {
        let e = entry(b)
        if (!e || b.$delete) continue
        if (
          e.seq != null && (!Number.isSafeInteger(e.seq) || Number(e.seq) < 1)
        ) {
          throw new Error(
            'entry.seq must be a positive integer; omit seq to append atomically',
          )
        }
        let previous = entry(existing.find((o) => o.entity.eid == b.entity.eid))
        if (
          previous?.session != null && e.session != null &&
          previous.session != e.session
        ) {
          throw new Error('entry.session cannot move an existing entry')
        }
        if (e.session == null) {
          e.session = entry(existing.find((o) => o.entity.eid == b.entity.eid))
            ?.session
        }
        if (e.session != null) {
          let id = String(e.session)
          groups.set(id, [...groups.get(id) ?? [], b])
        }
      }
      // Allocate parent entries before children that fork from the same batch.
      let ordered: string[] = [], visiting = new Set<string>()
      let order = (id: string) => {
        if (ordered.includes(id)) return
        if (visiting.has(id)) {
          throw new Error(
            'cyclic fork ancestry in append batch',
          )
        }
        visiting.add(id)
        let from =
          (bundles.find((b) => b.entity.eid == id)?.fork as Comp | undefined)
            ?.from
        let parent = entry(bundles.find((b) => b.entity.eid == from))?.session
        if (parent && groups.has(String(parent))) order(String(parent))
        visiting.delete(id)
        ordered.push(id)
      }
      for (let id of groups.keys()) order(id)
      let pending: void | Promise<void> = undefined
      for (let session of ordered) {
        let batch = groups.get(session)!
        pending = then(pending, () =>
          then(
            tx.read(
              parse(
                '.entry.session=' + session + '&.order=-entry.seq&.limit=1',
              ),
            ),
            (latest) =>
              then(
                batch.some((b) => entry(b)?.seq != null)
                  ? tx.read(
                    parse(
                      '.entry.session=' + session + '&.seq>=' +
                        Math.min(
                          ...batch.filter((b) => entry(b)?.seq != null).map((
                            b,
                          ) => Number(entry(b)!.seq)),
                        ) + '&.seq<=' + Math.max(
                          ...batch.filter((b) => entry(b)?.seq != null).map((
                            b,
                          ) => Number(entry(b)!.seq)),
                        ),
                    ),
                  )
                  : [],
                (collisions) => {
                  let own = [
                    ...existing.filter((b) => entry(b)?.session == session),
                    ...latest,
                    ...collisions,
                  ]
                  return then(tx.get([session]), (found) => {
                    if (
                      !found[0]?.session &&
                      !bundles.some((b) => b.entity.eid == session && b.session)
                    ) throw new UnknownSession(session)
                    let self = bundles.find((b) =>
                      b.entity.eid == session && b.fork
                    ) ?? found[0]
                    let from = (self?.fork as Comp | undefined)?.from
                    let anchorInBatch = bundles.find((b) =>
                      b.entity.eid == from
                    )
                    return then(
                      from && !anchorInBatch ? tx.get([String(from)]) : [],
                      (anchors) => {
                        let floor = Number(
                          entry(
                            anchorInBatch ?? anchors[0] ??
                              { entity: { eid: '' } },
                          )?.seq ?? 0,
                        )
                        let max = Math.max(
                          floor,
                          ...own.map((b) => Number(entry(b)?.seq ?? 0)),
                        )
                        let occupied = new Map(
                          own.map((b) => [Number(entry(b)?.seq), b.entity.eid]),
                        )
                        for (let b of batch) {
                          let e = entry(b)!
                          let old = own.find((o) =>
                            o.entity.eid == b.entity.eid
                          )
                          if (
                            old && e.seq != null && e.seq != entry(old)?.seq
                          ) {
                            throw new Error(
                              'entry.seq cannot move an existing entry',
                            )
                          }
                          let seq = e.seq == null
                            ? entry(old)?.seq ?? Math.floor(max) + 1
                            : e.seq
                          if (!Number.isSafeInteger(seq) || Number(seq) < 1) {
                            throw new Error(
                              'entry sequence exhausted',
                            )
                          }
                          if (
                            Number(seq) <= floor ||
                            (occupied.has(Number(seq)) &&
                              occupied.get(Number(seq)) != b.entity.eid)
                          ) {
                            throw new Error(
                              'entry.seq is occupied or precedes the fork boundary; omit seq to append atomically',
                            )
                          }
                          e.seq = seq
                          occupied.set(Number(seq), b.entity.eid)
                          max = Math.max(max, Number(seq))
                        }
                      },
                    )
                  })
                },
              ),
          ))
      }
      return then(pending, () => bundles)
    },
  )

/** Append an ordinary input or a passive notice. The session plugin assigns seq
 * inside the graph transaction. Supply an eid for idempotent delivery. */
export let appendEntry = (g: Graph, session: string, body: string, opts: {
  eid?: string
  notice?: boolean
} = {}): Bundle[] | Promise<Bundle[]> =>
  g.apply([{
    entity: { eid: opts.eid ?? crypto.randomUUID() },
    entry: { session },
    content: { body },
    ...opts.notice ? { notice: {} } : {},
  }])
