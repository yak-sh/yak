// Sync failures are admitted straight to the local tracker, whose mail duty
// is independent of remote delivery. They must never enter their own outbox.
import type { Graph } from '@yaks/graph'
import { ingest } from './intake.ts'
import { capture } from './report.ts'

export type Timer = (run: () => void, ms: number) => () => void
export let timer: Timer = (run, ms) => {
  let id = setTimeout(run, ms)
  return () => clearTimeout(id)
}

/** One notice per uninterrupted failure, including a pass that never settles.
 * A successful pass re-arms it. The original errand keeps its own outcome. */
export let watching = (
  notice: (error: Error) => Promise<void>,
  direction: string,
  after: Timer = timer,
  overdue = 60_000,
  signal?: AbortSignal,
): (pass: () => Promise<void>) => Promise<void> => {
  let failed = false
  let say = (held: boolean) => {
    if (failed || signal?.aborted) return
    failed = true
    return notice(Error(
      `Tracker ${direction} sync ${
        held ? 'has not completed in a minute' : 'failed'
      }; retrying. The remote and box views may disagree.`,
    )).catch((error) => {
      failed = false
      console.error('tracker sync notice failed —', error)
    })
  }
  return async (pass) => {
    let cancel = after(() => void say(true), overdue)
    try {
      await pass()
      failed = false
    } catch (error) {
      await say(false)
      throw error
    } finally {
      cancel()
    }
  }
}

export let syncNotice = (graph: Graph, direction: string) => (error: Error) =>
  ingest(
    graph,
    capture(error, {
      sink: () => {},
      fault: `tracker_sync:${direction}`,
      version: Date.now(),
      tags: { source: 'box', handler: 'tracker_sync', direction },
    }),
  )
