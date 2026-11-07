// A file's checkpoints, on a thread of their own. A checkpoint copies the
// WAL's pages into the file and syncs it, and on this box's disk that sync can
// wait seconds behind other processes' writes: inside a COMMIT, as SQLite runs
// its own, it held a server's main thread 5.6 s (bug bace8585). The thread
// checkpoints through a connection of its own, PASSIVE, so no writer or reader
// waits for it, and holds no process open: one that exits mid-checkpoint
// leaves a WAL the next commit past the mark asks for again.

import { Worker } from 'node:worker_threads'

/** What the thread answers for a file it checkpointed. */
export type Done = { path: string; error?: string }

let worker: Worker | undefined
// The files asked for and not yet answered: one request each at a time.
let asked = new Set<string>()

let start = () => {
  let w = new Worker(new URL('./checkpoint_worker.ts', import.meta.url))
  w.unref()
  w.on('message', ({ path, error }: Done) => {
    asked.delete(path)
    if (error) reportError(new Error(`checkpoint of ${path} failed: ${error}`))
  })
  w.on('error', (error) => {
    worker = undefined
    asked.clear()
    reportError(error)
  })
  return w
}

/** Ask the thread to checkpoint the file at `path`, unless it already is. */
export let checkpoint = (path: string): void => {
  if (asked.has(path)) return
  asked.add(path)
  ;(worker ??= start()).postMessage(path)
}
