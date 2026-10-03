// Intake keeps immutable reporter bundles once. Grouping adds its receipt to
// that same occurrence, which a redelivery must never erase.

import type { Bundle, Graph } from '@yaks/graph'

export type Record = { rows: Bundle[]; ack: () => void | Promise<void> }
export type Source = () => AsyncIterable<Record>

export let ingest = async (g: Graph, rows: Bundle[]): Promise<void> => {
  let unique = [...new Map(rows.map((row) => [row.entity.eid, row])).values()]
  let known = new Set((await g.get(unique.map((row) => row.entity.eid)))
    .map((row) => row.entity.eid))
  let fresh = unique.filter((row) => !known.has(row.entity.eid))
  if (fresh.length) await g.apply(fresh, { trusted: true })
}

export let intake = async (g: Graph, source: Source): Promise<void> => {
  for await (let record of source()) {
    await ingest(g, record.rows)
    await record.ack()
  }
}
