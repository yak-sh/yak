// Intake keeps immutable reporter bundles once. Grouping adds its receipt to
// that same occurrence, which a redelivery must never erase.

import type { Bundle, Graph } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'

export type Record = {
  rows: Bundle[]
  ack: () => void | Promise<void>
  /** A durable local receipt, retained until remote delivery is acknowledged. */
  admitted?: boolean
  admit?: () => void | Promise<void>
  /** Sets the record aside, kept but no longer offered, once the graph
   * refuses it for good: retrying a refusal can never succeed. */
  refuse?: () => void | Promise<void>
}
export type Source = () => AsyncIterable<Record>

export let ingest = async (g: Graph, rows: Bundle[]): Promise<void> => {
  let unique = [...new Map(rows.map((row) => [row.entity.eid, row])).values()]
  // References can mint bare entity spines before a queued record arrives.
  // Those are not delivered records: admitting their later components is the
  // first intake, while a redelivery must still preserve an existing receipt.
  let known = new Set(
    (await g.get(unique.map((row) => row.entity.eid)))
      .filter((row) => Object.keys(row).some((name) => name != 'entity'))
      .map((row) => row.entity.eid),
  )
  let fresh = unique.filter((row) => !known.has(row.entity.eid))
  if (fresh.length) await g.apply(fresh, { trusted: true })
}

/** Passes over a source, each failure contained to its own record, then throws
 * what failed. A record the graph refuses is set aside (`refuse`); one that
 * failed otherwise (a locked database) stays and is offered again next pass.
 * Nothing behind a failing record waits for it. */
export let each = async (
  source: Source,
  stop: AbortSignal | undefined,
  work: (record: Record) => Promise<void>,
): Promise<void> => {
  let failed: unknown[] = []
  for await (let record of source()) {
    if (stop?.aborted) break
    try {
      await work(record)
    } catch (error) {
      failed.push(error)
      if (error instanceof Refused) await record.refuse?.()
    }
  }
  if (failed.length == 1) throw failed[0]
  if (failed.length) throw new AggregateError(failed, `${failed.length} failed`)
}

/** Every complete record, admitted then acknowledged. A `stop` that aborts
 * ends it between records: the one in hand is committed and acknowledged, and
 * the rest stay in the source for the next intake. */
export let intake = (
  g: Graph,
  source: Source,
  stop?: AbortSignal,
): Promise<void> =>
  each(source, stop, async (record) => {
    await ingest(g, record.rows)
    await record.ack()
  })

export {
  reserveTrace,
  TRACE_CEILING,
  TRACE_MAX_BUNDLES,
  TRACE_RESERVATION_WRITES,
  TRACE_ROW_BOUND,
  traceBatch,
  traceBudget,
} from './trace-intake.ts'
export type {
  TraceBatch,
  TraceBudget,
  TraceReservation,
} from './trace-intake.ts'
