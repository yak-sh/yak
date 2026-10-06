// Intake keeps immutable reporter bundles once. Grouping adds its receipt to
// that same occurrence, which a redelivery must never erase.

import type { Bundle, Graph } from '@yaks/graph'

export type Record = { rows: Bundle[]; ack: () => void | Promise<void> }
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

export let intake = async (g: Graph, source: Source): Promise<void> => {
  for await (let record of source()) {
    await ingest(g, record.rows)
    await record.ack()
  }
}

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
