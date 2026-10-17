// Poll committed revisions, not computed session status. A file can be written
// by another process, which an in-process subscription would never hear.
import type { Graph } from '@yaks/graph'

type Clock = {
  now: () => number
  after: (ms: number, callback: () => void) => () => void
}
let real: Clock = {
  now: () => Date.now(),
  after: (ms, callback) => {
    let timer = setTimeout(callback, ms)
    return () => clearTimeout(timer)
  },
}

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

/** Read initially and after committed changes, at most a second apart by
 * default. Always yield once more on timeout or abort. Stores without revision
 * support are read on each beat. The revision is sampled before the caller's
 * read, so a write during that read cannot be missed. */
export async function* changes(
  graph: { storage: Pick<Graph['storage'], 'revision'> },
  options: {
    every?: number
    timeout?: number
    signal?: AbortSignal
    clock?: Clock
  } = {},
): AsyncGenerator<boolean> {
  let clock = options.clock ?? real
  let end = clock.now() + (options.timeout ?? Infinity)
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
      Math.min(options.every ?? 1000, Math.max(0, end - clock.now())),
      options.signal,
    )
  }
}
