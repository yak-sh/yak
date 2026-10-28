// What the tracker service's syncs with the platform tracker report, and
// where. Which failure is reported, and when, is ./outage.ts's, as it is for
// the poll: a pass the platform tracker could not answer for a moment is a
// line in the log, one unanswered for OUTAGE reports once, and any other
// failure at once. Each report names the sync that failed, its cause why.
//
// Sync failures are admitted straight to the local tracker, whose mail duty
// is independent of remote delivery. They must never enter their own outbox.
import type { Graph } from '@yaks/graph'
import { ingest } from './intake.ts'
import { coalesce, type Coalesced, report } from './report.ts'
import { type Outage, outage, type Timer } from './outage.ts'

export type Direction = 'delivery' | 'standing'

/** Where a failed sync is told: an `Error` naming the sync, its cause the
 * failure. */
export type Notice = (error: Error, direction: Direction) => Promise<void>

/** The passes of one sync, each failure to fix told to `notice`. */
export let syncing = (
  direction: Direction,
  notice: Notice,
  opts: {
    every: number
    timer?: Timer
    signal?: AbortSignal
    log?: (line: string) => void
  },
): Outage =>
  outage({
    ...opts,
    name: `Tracker ${direction} sync`,
    report: (error) =>
      void notice(
        Error(
          `Tracker ${direction} sync failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        ),
        direction,
      ).catch((failure) =>
        console.error('tracker sync notice failed —', failure)
      ),
  })

/** Sync failures admitted to `graph` itself, a flood of one coalesced
 * (./report.ts `coalesce`); `close` sends the repeats a window holds. */
export let syncNotice = (graph: Graph): Notice & Pick<Coalesced, 'close'> => {
  let sink = coalesce((rows) => ingest(graph, rows))
  return Object.assign(
    (error: Error, direction: Direction) =>
      report(error, {
        sink,
        version: Date.now(),
        tags: { source: 'box', handler: 'tracker_sync', direction },
      }),
    { close: sink.close },
  )
}
