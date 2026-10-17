// Storage may certify that a refused transaction never began. Wait for that
// writer without replaying any work inside a transaction, or normalizing the
// person's batch again. Ordinary synchronous writes stay synchronous.

import { backoff, isPromise, sleep } from '@yaks/fp'

let retryable = (e: unknown): boolean =>
  !!e && typeof e == 'object' && 'retryable' in e && e.retryable === true

export let enter = <T>(
  open: (begun: () => void) => T | Promise<T>,
  pause: (ms: number) => Promise<void> = sleep,
): T | Promise<T> => {
  let started = false
  let attempt = 0
  let run = (): T | Promise<T> => {
    let failed = (error: unknown): Promise<T> => {
      if (started || !retryable(error) || ++attempt > 3) throw error
      return pause(backoff(attempt)).then(run)
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
