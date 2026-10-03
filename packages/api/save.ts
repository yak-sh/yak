// Saving is independent of relay cadence: hold the latest admitted value,
// store it once an interval, and finish a writer's pending values on close.
import { after, isPromise, over } from '@yaks/fp'
import {
  type Actor,
  type Bundle,
  type Comp,
  composed,
  comps,
  type Graph,
  signed,
} from '@yaks/graph'
import { saveOf } from '@yaks/vocab'
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
  at: number
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
  let save = (v: Value<C>) => {
    v.cancel?.()
    v.cancel = undefined
    if (!v.dirty) return
    let row = v.row
    return after(graph.apply(signedRows([row], v.writer)), () => {
      v.at = now()
      // Another admitted patch can arrive while an asynchronous store writes.
      if (v.row === row) v.dirty = false
    })
  }
  let write = (conn: C, bundles: Bundle[], writer: PeerWriter = {}) => {
    let rows = composed(bundles).flatMap((b) =>
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
    if (!rows.length) return
    // Rehearse before changing ownership or the relay's held value. In
    // particular, an unauthorized takeover must not replace an owed save.
    return after(
      graph.apply(signedRows(rows, writer), { check: true }),
      () =>
        after(
          over(rows, (row) => {
            let [comp, patch] = comps(row)[0]
            let key = row.entity.eid + ' ' + comp
            let was = values.get(key)
            let v: Value<C> = was ??
              { conn, writer, row, at: -Infinity, dirty: false }
            v.conn = conn
            v.writer = writer
            v.row = row
            v.dirty = true
            values.set(key, v)
            let wait = v.at + saveOf(graph.vocab, comp)! - now()
            if (patch == null || wait <= 0) {
              return after(save(v), () => {
                if (patch == null && values.get(key) === v) values.delete(key)
              })
            }
            if (!v.cancel) {
              v.cancel = timer(() => {
                v.cancel = undefined
                try {
                  let out = save(v)
                  if (isPromise(out)) {
                    return out.catch((err) => failed(v.conn, err))
                  }
                } catch (err) {
                  failed(v.conn, err)
                }
              }, wait)
            }
          }),
          () => {},
        ),
    )
  }
  let drop = (conn: C) =>
    after(
      over([...values], ([key, v]) => {
        if (v.conn !== conn) return
        let forget = () => {
          v.cancel?.()
          if (values.get(key) === v) values.delete(key)
        }
        let refused = (err: unknown) => {
          forget()
          failed(conn, err)
        }
        try {
          let out = save(v)
          return isPromise(out) ? out.then(forget, refused) : forget()
        } catch (err) {
          refused(err)
        }
      }),
      () => {},
    )
  return { write, drop }
}
