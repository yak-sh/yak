// The box service consumes complete spool records and checkpoints only after
// graph admission. A crash between apply and ack resends the reporter's eids.

import type { Bundle, Graph } from '@yaks/graph'
import { sleep } from '@yaks/effects'
import { files } from './file.ts'
import { caught, spool } from './report.ts'

export type Record = { rows: Bundle[]; ack: () => void | Promise<void> }
export type Source = () => AsyncIterable<Record>
export type Options = {
  source?: Source
  spool?: string
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
  host: {
    graph: Graph
    config?: { tracker?: { spool: string } }
  },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  let dir = options.spool ?? host.config?.tracker?.spool
  let source = options.source ?? (dir ? files(dir).source : undefined)
  if (!source) return
  do {
    try {
      await intake(host.graph, source)
    } catch (error) {
      try {
        if (options.report) options.report(error)
        else if (dir) await caught(error, { sink: spool(files(dir).append) })
        else console.error(error)
      } catch { /* keep the spool */ }
      if (signal.aborted) throw error
    }
    if (signal.aborted) return
    await sleep(options.every ?? 1000, signal)
  } while (!signal.aborted)
}
