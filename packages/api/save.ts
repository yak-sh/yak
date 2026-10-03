// Saving is independent of relay cadence: hold the latest admitted value,
// store it when its stored entity matches the query, even after disconnect.
import { after, isPromise, over } from '@yaks/fp'
import {
  type Actor,
  type Bundle,
  type Comp,
  comps,
  formed,
  type Graph,
  signed,
} from '@yaks/graph'
import { saveOf, syncOf } from '@yaks/vocab'
import { and, eq, parse } from '@yaks/query'
import type { Timer } from './relay.ts'

/** The receiving door's identity and vocabulary versions, never client claims. */
export type PeerWriter = {
  actor?: Actor | null
  speaks?: Record<string, number>
}

type Value<C> = {
  conn: C
  writer: PeerWriter
  row: Bundle
  connected: boolean
  dirty: boolean
  cancel?: () => void
}

/** Latest peer values saved through the graph's ordinary write boundary. */
export let saving = <C>(
  graph: Graph,
  timer: Timer,
  failed: (conn: C, err: unknown) => void,
  now: () => number = () => Date.now(),
) => {
  let values = new Map<string, Value<C>>()
  let signedRows = (rows: Bundle[], writer: PeerWriter) =>
    signed(
      rows.map((b) => ({
        ...b,
        ...writer.speaks ? { $speaks: writer.speaks } : {},
      })),
      writer.actor ?? null,
    )
  let forget = (key: string, v: Value<C>) => {
    v.cancel?.()
    v.cancel = undefined
    if (values.get(key) === v) values.delete(key)
  }
  let save = (key: string, v: Value<C>) => {
    v.cancel?.()
    v.cancel = undefined
    if (!v.dirty) return
    let [comp] = comps(v.row)[0]
    let query = and(
      eq('entity.eid', v.row.entity.eid),
      parse(saveOf(graph.vocab, comp)!),
    )
    return after(graph.read(query, { now: now(), native: true }), (rows) => {
      if (!rows.length) {
        // Queries can change with time or another stored write. Recheck only
        // while a value is pending, including the last one after disconnect.
        v.cancel = timer(() => {
          v.cancel = undefined
          try {
            let out = save(key, v)
            if (isPromise(out)) return out.catch((err) => failed(v.conn, err))
          } catch (err) {
            failed(v.conn, err)
          }
        }, 1000)
        return
      }
      let row = v.row
      return after(graph.apply(signedRows([row], v.writer)), () => {
        if (v.row === row) v.dirty = false
        if (!v.connected || comps(row)[0][1] == null) forget(key, v)
      })
    })
  }
  let write = (
    conn: C,
    bundles: Bundle[],
    writer: PeerWriter = {},
    held: Bundle[] = [],
  ) => {
    bundles = formed(bundles)
    // Pending saves survive disconnect; current relay values also supply the
    // complete proposed component for checking a partial patch.
    let overlay = bundles.flatMap((b) =>
      comps(b).flatMap(([comp]) => {
        let v = values.get(b.entity.eid + ' ' + comp)
        return v ? [v.row] : []
      })
    ).concat(held)
    return after(
      graph.admit(signedRows(bundles, writer), { overlay }),
      (admitted) => {
        let accepted = admitted.flatMap((b) => {
          let row: Bundle = { entity: { eid: b.entity.eid } }
          for (let [comp, patch] of comps(b)) {
            if (syncOf(graph.vocab, comp) == 'peers') row[comp] = patch
          }
          return comps(row).length ? [row] : []
        })
        let rows = accepted.flatMap((b) =>
          comps(b).flatMap(([comp, patch]) =>
            saveOf(graph.vocab, comp) == null ? [] : [{
              entity: b.entity,
              [comp]: patch == null ? null : {
                ...values.get(b.entity.eid + ' ' + comp)?.row[comp] as Comp,
                ...patch,
              },
            }]
          )
        )
        return after(
          over(rows, (row) => {
            let [comp] = comps(row)[0]
            let key = row.entity.eid + ' ' + comp
            let was = values.get(key)
            let v: Value<C> = was ??
              { conn, writer, row, connected: true, dirty: false }
            v.connected = true
            v.conn = conn
            v.writer = writer
            v.row = row
            v.dirty = true
            values.set(key, v)
            return save(key, v)
          }),
          () => accepted,
        )
      },
    )
  }
  let drop = (conn: C) =>
    after(
      over([...values], ([key, v]) => {
        if (v.conn !== conn) return
        v.connected = false
        if (!v.dirty) return forget(key, v)
        let refused = (err: unknown) => {
          forget(key, v)
          failed(conn, err)
        }
        try {
          let out = save(key, v)
          return isPromise(out) ? out.catch(refused) : out
        } catch (err) {
          refused(err)
        }
      }),
      () => {},
    )
  return { write, drop }
}
