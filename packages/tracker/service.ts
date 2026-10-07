// The box service consumes complete spool records and checkpoints only after
// graph admission. A crash between apply and ack resends the reporter's eids.

import type { Graph } from '@yaks/graph'
import { intake, type Source } from './intake.ts'
export { intake, type Record, type Source } from './intake.ts'
import { sleep } from '@yaks/effects'
import { files } from './file.ts'
import { caught, spool } from './report.ts'

export type Options = {
  source?: Source
  spool?: string
  every?: number
  report?: (error: unknown) => void
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
  // A pass made with a signal already aborted takes the whole backlog once. A
  // service that stays up stops between records when its signal aborts, so a
  // drain never waits out a backlog: what it has not taken stays spooled.
  let stop = signal.aborted ? undefined : signal
  do {
    try {
      await intake(host.graph, source, stop)
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
