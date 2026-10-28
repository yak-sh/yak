// Local admission and remote delivery share a durable outbox, not a clock.
// Only admission plus successful forwarding may acknowledge an error record.

import type { Graph } from '@yaks/graph'
import { each, intake, type Record, type Source } from './intake.ts'
export { intake, type Record, type Source } from './intake.ts'
import { sleep } from '@yaks/effects'
import { files } from './file.ts'
import { caught, type Context, spool } from './report.ts'
import { delivery, type Remote, Unavailable } from './remote.ts'
import { reconcile } from './reconcile.ts'
import type { Timer } from './outage.ts'
import {
  type Direction,
  type Notice,
  syncing,
  syncNotice,
} from './sync_health.ts'

export type Options = {
  source?: Source
  spool?: string
  every?: number
  report?: (error: unknown, context?: Partial<Context>) => void
  remote?: Remote
  fetch?: typeof fetch
  /** how the outage's wait is set (./outage.ts), so a test can hold the
   * clock */
  timer?: Timer
  /** Independent local notice path; never forwarded into the failing outbox. */
  notice?: Notice
  /** a sync the platform tracker could not answer, and its answering again
   * (default: `console.warn`) */
  log?: (line: string) => void
  reconcileEvery?: number
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
    let pending: Record[] = [], bundles = 0
    let flush = async () => {
      if (!pending.length) return
      let batch = pending
      pending = []
      bundles = 0
      // The signed intake admits up to 100 bundles. A spool receipt is not
      // acknowledged until every bundle in this batch reached that door.
      await send(batch.flatMap(errors))
      for (let record of batch) await record.ack()
    }
    let failures: unknown[] = []
    let attempt = async () => {
      try {
        await flush()
      } catch (error) {
        failures.push(error)
      }
    }
    await each(source, stop, async (record) => {
      let rows = errors(record)
      if (!rows.some((row) => row.error)) return
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
      if (rows.length > 100) {
        throw Error('Tracker record exceeds remote intake bound')
      }
      if (bundles + rows.length > 100) await attempt()
      pending.push(record)
      bundles += rows.length
      if (bundles == 100) await attempt()
    }).catch((error) => failures.push(error))
    await attempt()
    if (!failures.length) return
    // Batches the tracker could not answer for now are one outage, not a bug.
    let bug = failures.find((error) => !(error instanceof Unavailable))
    if (failures.length == 1 || !bug) throw failures.at(-1)
    throw new AggregateError(failures, 'Tracker delivery batches failed', {
      cause: bug,
    })
  }
  let every = options.every ?? 1000
  let reconcileEvery = options.reconcileEvery ?? 30_000
  let notices = options.notice ? undefined : syncNotice(host.graph)
  let health = (direction: Direction, every: number) =>
    syncing(direction, options.notice ?? notices!, {
      every,
      timer: options.timer,
      signal: stop,
      log: options.log,
    })
  let outward = health('delivery', every)
  let inward = health('standing', reconcileEvery)
  // The tag of the remote standing the last reconciliation applied in full.
  let seen: { tag?: string } = {}

  // A failed intake pass is reported. A sync's failure is its watch's to
  // tell (./sync_health.ts), so a failed retry never reports into its own
  // outbox.
  let unadmitted = async (error: unknown) => {
    try {
      if (options.report) {
        options.report(error, { tags: { handler: 'tracker_intake' } })
      } else if (dir) {
        await caught(error, {
          sink: spool(files(dir).append),
          tags: { handler: 'tracker_intake' },
        })
      } else console.error(error)
    } catch { /* keep the spool */ }
  }
  let run = async (
    pass: () => Promise<void>,
    tell: (error: unknown) => Promise<void> = async () => {},
    wait = every,
  ) => {
    do {
      try {
        await pass()
      } catch (error) {
        if (stop?.aborted && error === stop.reason) return
        await tell(error)
        if (signal.aborted) throw error
      }
      if (signal.aborted) return
      await sleep(wait, signal)
    } while (!signal.aborted)
  }
  let standing = () =>
    inward(() =>
      reconcile(host.graph, options.remote!, options.fetch, stop, seen)
    )
  try {
    if (signal.aborted) {
      await run(() => intake(host.graph, local), unadmitted)
      await run(() => outward(forward))
      if (options.remote) await run(standing)
    } else {
      // Neither remote refusal nor a minute of connection retries can delay a
      // later local record. The retained immutable eids make both loops
      // replayable.
      let results = await Promise.allSettled([
        run(() => intake(host.graph, local, stop), unadmitted),
        ...send
          ? [
            run(() => outward(forward)),
            run(standing, undefined, reconcileEvery),
          ]
          : [],
      ])
      for (let result of results) {
        if (result.status == 'rejected') throw result.reason
      }
    }
  } finally {
    outward.close()
    inward.close()
    await notices?.close()
  }
}
