// The box service consumes complete spool records and checkpoints only after
// graph admission. A crash between apply and ack resends the reporter's eids.

import type { Bundle, Graph } from '@yaks/graph'
import { sleep } from '@yaks/effects'

export type Record = { rows: Bundle[]; ack: () => void | Promise<void> }
export type Source = () => AsyncIterable<Record>
export type Options = {
  source?: Source
  every?: number
  report?: (error: unknown) => void
}

export let intake = async (g: Graph, source: Source): Promise<void> => {
  for await (let record of source()) {
    await g.apply(record.rows, { trusted: true })
    await record.ack()
  }
}
export let service = async (
  host: { graph: Graph },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  if (!options.source) return
  do {
    try {
      await intake(host.graph, options.source)
    } catch (error) {
      try {
        ;(options.report ?? console.error)(error)
      } catch { /* keep the spool */ }
      if (signal.aborted) throw error
    }
    if (signal.aborted) return
    await sleep(options.every ?? 1000, signal)
  } while (!signal.aborted)
}
