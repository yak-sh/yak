// The box service consumes complete spool records and checkpoints only after
// graph admission. A crash between apply and ack resends the reporter's eids.

import type { Graph } from '@yaks/graph'
import { intake, type Source } from './intake.ts'
export { intake, type Record, type Source } from './intake.ts'
import { sleep } from '@yaks/effects'
import { files } from './file.ts'
import { caught, type Context, spool } from './report.ts'
import { delivery, type Remote } from './remote.ts'

export type Options = {
  source?: Source
  spool?: string
  every?: number
  report?: (error: unknown, context?: Partial<Context>) => void
  remote?: Remote
  fetch?: typeof fetch
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
  let send = options.remote
    ? delivery(options.remote, options.fetch)
    : undefined
  // A pass made with a signal already aborted takes the whole backlog once. A
  // service that stays up stops between records when its signal aborts, so a
  // drain never waits out a backlog: what it has not taken stays spooled.
  let stop = signal.aborted ? undefined : signal
  do {
    let delivering = false
    try {
      let pending = async function* () {
        for await (let record of source()) {
          if (stop?.aborted) return
          if (send) {
            delivering = true
            await send(record.rows)
            delivering = false
          }
          yield record
        }
      }
      await intake(host.graph, pending, stop)
    } catch (error) {
      try {
        // Delivery keeps the original durable record owed. Reporting its
        // failed retry into that same outbox would create an endless backlog.
        if (delivering) console.error('tracker delivery failed —', error)
        else if (options.report) {
          options.report(error, { tags: { handler: 'tracker_intake' } })
        } else if (dir) {
          await caught(error, {
            sink: spool(files(dir).append),
            tags: { handler: 'tracker_intake' },
          })
        } else console.error(error)
      } catch { /* keep the spool */ }
      if (signal.aborted) throw error
    }
    if (signal.aborted) return
    await sleep(options.every ?? 1000, signal)
  } while (!signal.aborted)
}
