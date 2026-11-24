import type { Bundle, Comp, Graph, Tx } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { after } from '@yaks/fp'
import { line } from '@yaks/query'

export let DIRECT_CAP = 20
let WEEK = 7 * 86_400_000
let BATCH = 50

export let directUntil = (at: number): string =>
  new Date(at + WEEK).toISOString()

export let directDeadline = (row: Bundle): number => {
  let until = (row.chat_dm as Comp | undefined)?.until
  return until
    ? Date.parse(String(until))
    : Date.parse(String((row.created as Comp | undefined)?.at)) + WEEK
}

/** Check admission in the same transaction that queues the message. A
 * sender with an open seat can still reach their Operator at capacity. */
export let admitDirect = (
  tx: Tx,
  row: Bundle,
  now: number,
  seated: (dm: Comp) => boolean | Promise<boolean>,
): Bundle | null | Promise<Bundle | null> => {
  let dm = row.chat_dm as Comp
  let held = line`.chat_dm.via=${String(dm.via)}&.chat_dm.account=${
    String(dm.account)
  }&.chat_dm.said&(.chat_dm.until>now|(!chat_dm.until&.created.at>"7d ago"))&.limit=${DIRECT_CAP}&.fields=entity.eid`
  let queued = { ...row, chat_dm: { ...dm, until: directUntil(now) } }
  return after(
    tx.read(held, { now }),
    (rows) =>
      rows.length < DIRECT_CAP
        ? queued
        : after(seated(dm), (yes) => yes ? queued : null),
  )
}

/** Existing undelivered rows expire a week after they were first queued. */
export let dateDirect = (row: Bundle): Bundle[] => {
  let at = Date.parse(String((row.created as Comp | undefined)?.at))
  let said = (row.chat_dm as Comp | undefined)?.said
  if (!said || !Number.isFinite(at)) return []
  return [{
    entity: { eid: row.entity.eid },
    chat_dm: { until: directUntil(at) },
    $was: { chat_dm: { until: null, said: token(said) } },
  }]
}

type Queue = Pick<Graph, 'read' | 'book'>

export let nextDirect = async (g: Queue): Promise<number | null> => {
  let [row] = await g.read(
    '.chat_dm.until&.order=chat_dm.until&.limit=1&.fields=chat_dm.until',
  )
  return row ? Date.parse(String((row.chat_dm as Comp).until)) : null
}

/** Drop due intake and receipts without retaining message text in trash. */
export let expireDirect = async (
  g: Queue,
  now: number,
): Promise<number | null> => {
  let rows = await g.read(
    line`.chat_dm.until<=now&.order=chat_dm.until&.limit=${BATCH}&.fields=chat_dm.until`,
    { now },
  )
  if (rows.length) {
    try {
      await g.book(rows.map(({ entity, chat_dm }) => ({
        entity,
        $delete: true,
        $was: { chat_dm: { until: token((chat_dm as Comp).until) } },
      })))
    } catch (error) {
      if (!(error instanceof Stale)) throw error
    }
  }
  return nextDirect(g)
}
