// Local admission and remote delivery share a durable outbox, not a clock.
// Only admission plus successful forwarding may acknowledge an error record.

import type { Graph } from '@yaks/graph'
import { each, intake, type Record, type Source } from './intake.ts'
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

let errors = (record: Record) =>
  record.rows.filter((row) => row.error || row.request)

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
  // An already aborted signal requests one complete pass. A live service stops
  // between records, finishing the record in hand before releasing its lease.
  let stop = signal.aborted ? undefined : signal
  let local = async function* () {
    for await (let record of source()) {
      if (stop?.aborted) return
      if (send && errors(record).some((row) => row.error)) {
        if (record.admitted) continue
        yield { ...record, ack: record.admit ?? (() => {}) }
      } else if (record.admitted) await record.ack()
      else yield record
    }
  }
  let forward = async () => {
    if (!send) return
    await each(source, stop, async (record) => {
      let rows = errors(record)
      if (!rows.some((row) => row.error)) return
      // The local loop owns admission. Bare reference spines do not count as
      // receipts; never remove a record before all its bundles are admitted.
      let admitted = record.admitted ?? (record.admit ? false : undefined)
      if (admitted === undefined) {
        let known = new Set(
          (await host.graph.get(record.rows.map((row) => row.entity.eid)))
            .filter((row) => Object.keys(row).some((name) => name != 'entity'))
            .map((row) => row.entity.eid),
        )
        admitted = record.rows.every((row) => known.has(row.entity.eid))
      }
      if (!admitted) return
      await send(rows)
      await record.ack()
    })
  }
  let run = async (pass: () => Promise<void>, remote = false) => {
    do {
      try {
        await pass()
      } catch (error) {
        try {
          // A failed retry must not report into its own outbox.
          if (remote) console.error('tracker delivery failed —', error)
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
  if (signal.aborted) {
    await run(() => intake(host.graph, local))
    await run(forward, true)
  } else {
    // Neither remote refusal nor a minute of connection retries can delay a
    // later local record. The retained immutable eids make both loops replayable.
    let results = await Promise.allSettled([
      run(() => intake(host.graph, local, stop)),
      ...send ? [run(forward, true)] : [],
    ])
    for (let result of results) {
      if (result.status == 'rejected') throw result.reason
    }
  }
}
