// A completed answer waits for storage without running its tool again.
// Only storage's explicit assurance that nothing committed permits a retry.

import { backoff, sleep } from '@yaks/effects'

let retryable = (e: unknown): boolean =>
  !!e && typeof e == 'object' && 'retryable' in e && e.retryable === true

export let persist = async <T>(
  write: () => T | Promise<T>,
  report: (e: unknown) => unknown,
): Promise<T> => {
  for (let attempt = 1;; attempt++) {
    try {
      return await write()
    } catch (e) {
      if (!retryable(e)) throw e
      if (attempt == 1) await report(e)
      await sleep(backoff(attempt))
    }
  }
}
