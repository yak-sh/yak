// Rebuildable database caches are compacted on their existing inode, so live
// processes cannot keep a removed cache growing outside its budget.
import { sleep } from '@yaks/fp'
import { type Cache, trim } from './cache.ts'

export type Options = {
  /** Database paths, each with its byte budget and table-to-file-URL-column map. */
  caches?: Record<string, Cache>
  /** Milliseconds between passes; defaults to one hour. */
  every?: number
}

/** Maintain configured caches until the host stops. Each failure reaches the
 * host's telemetry and leaves the next pass able to try again. */
export let service = async (
  host: {
    report?: (
      error: unknown,
      context?: { tags?: Record<string, string> },
    ) => unknown
  },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
  maintain: typeof trim = trim,
): Promise<void> => {
  for (;;) {
    for (let [path, cache] of Object.entries(options.caches ?? {})) {
      try {
        await maintain(path, cache)
      } catch (error) {
        ;(host.report ?? console.error)(error, {
          tags: { step: 'cache trim', path },
        })
      }
    }
    if (signal.aborted) return
    await sleep(options.every ?? 60 * 60 * 1000, signal)
    if (signal.aborted) return
  }
}
