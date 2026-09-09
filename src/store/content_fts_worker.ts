// The additive transcript-index backfill, isolated from the serving loop.
// connect(), not open(): the parent has committed the schema already and a
// maintenance worker must neither rerun migrations nor spawn another worker.
/// <reference lib="webworker" />
import { fillContentFts } from '../db.ts'
import { connect } from './sqlite.ts'

let stopped = false
self.onmessage = async (
  event: MessageEvent<{ path?: string; stop?: boolean }>,
) => {
  if (event.data.stop) {
    stopped = true
    return
  }
  if (!event.data.path) return
  let db: ReturnType<typeof connect> | undefined
  try {
    db = connect(event.data.path)
    while (!stopped && fillContentFts(db)) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    self.postMessage({ done: true })
  } catch (error) {
    // The cursor is durable; a subsequent opener retries after a failure.
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    db?.close()
    self.close()
  }
}
