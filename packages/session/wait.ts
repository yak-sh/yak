// Poll committed revisions, not computed session status. A file can be written
// by another process, which an in-process subscription would never hear.
import type { Graph } from '@yaks/graph'

/** The time a wait keeps: when it is, and a callback after a delay that the
 * returned function cancels. */
export type Clock = {
  now: () => number
  after: (ms: number, callback: () => void) => () => void
}

/** The system's clock. */
export let system: Clock = {
  now: () => Date.now(),
  after: (ms, callback) => {
    let timer = setTimeout(callback, ms)
    return () => clearTimeout(timer)
  },
}

// The first beat. Each beat doubles it up to `every`, so a wait answers within
// about the time it has already waited, and a long one costs a read a beat.
let start = 25

let pause = (clock: Clock, ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    let done = () => {
      cancel()
      signal?.removeEventListener('abort', done)
      resolve()
    }
    let cancel = clock.after(ms, done)
    signal?.addEventListener('abort', done, { once: true })
    if (signal?.aborted) done()
  })

/** Read initially and after committed changes, on a beat that starts at 25 ms
 * and doubles until it is `every` (a second by default). Always yield once
 * more on timeout or abort. Stores without revision support are read on each
 * beat. The revision is sampled before the caller's read, so a write during
 * that read cannot be missed. */
export async function* changes(
  graph: { storage: Pick<Graph['storage'], 'revision'> },
  options: {
    every?: number
    timeout?: number
    signal?: AbortSignal
    clock?: Clock
  } = {},
): AsyncGenerator<boolean> {
  let clock = options.clock ?? system
  let every = options.every ?? 1000
  let end = clock.now() + (options.timeout ?? Infinity)
  let beat = Math.min(start, every)
  let first = true, prior: unknown
  for (;;) {
    let done = !!options.signal?.aborted || clock.now() >= end
    let revision = graph.storage.revision?.()
    if (first || done || revision === undefined || revision !== prior) {
      prior = revision
      first = false
      yield done
    }
    if (done) return
    await pause(
      clock,
      Math.min(beat, Math.max(0, end - clock.now())),
      options.signal,
    )
    beat = Math.min(beat * 2, every)
  }
}
