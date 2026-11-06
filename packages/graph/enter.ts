// Storage may certify that a refused transaction never began. Wait for that
// writer without replaying any work inside a transaction, or normalizing the
// person's batch again. Ordinary synchronous writes stay synchronous.
//
// The wait is the one a file's busy timeout gave, a minute, but spent between
// tries instead of asleep inside one, so the thread serves everything else
// while another writer finishes. Pauses start short, as most writers hold the
// lock for milliseconds, and grow to a quarter second.

import { isPromise, sleep } from '@yaks/fp'

let retryable = (e: unknown): boolean =>
  !!e && typeof e == 'object' && 'retryable' in e && e.retryable === true

/// pause(1) -> 5
/// pause(4) -> 40
/// pause(20) -> 250
/** How long the `attempt`th refused entry waits before trying again, in ms. */
export let pause = (attempt: number): number =>
  Math.min(250, 5 * 2 ** (attempt - 1))

/** The most an entry waits, in all, for another writer. */
export let PATIENCE = 60_000

export let enter = <T>(
  open: (begun: () => void) => T | Promise<T>,
  wait: (ms: number) => Promise<void> = sleep,
): T | Promise<T> => {
  let started = false
  let attempt = 0
  let waited = 0
  let run = (): T | Promise<T> => {
    let failed = (error: unknown): Promise<T> => {
      let ms = pause(++attempt)
      if (started || !retryable(error) || waited + ms > PATIENCE) throw error
      waited += ms
      return wait(ms).then(run)
    }
    try {
      let out = open(() => started = true)
      return isPromise(out) ? Promise.resolve(out).catch(failed) : out
    } catch (error) {
      return failed(error)
    }
  }
  return run()
}
