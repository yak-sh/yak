/**
 * A long-running process can sleep until the next wake instead of polling at a
 * fixed rate. The cap lets newly written wakes be noticed without a
 * subscription, and keeps an empty graph and a far-off date within
 * `setTimeout`'s range. Stopping aborts only the wait: a graph write already
 * underway finishes its phases.
 * @module
 */

import { soonest } from './due.ts'
import { type Driver, tick, type Ticked } from './tick.ts'

/** The loop's lifetime, its maximum sleep, and a callback run after each
 * tick. */
export type LoopOpts = {
  /** abort to stop the loop and release its timer */
  signal?: AbortSignal
  /** maximum sleep in milliseconds (default one minute); also the retry
   * interval for wakes whose transaction was rejected, and the delay while the
   * graph has nothing scheduled */
  cap?: number
  /** called after each tick with the fired and rejected wakes */
  onTick?: (result: Ticked) => void | Promise<void>
}

let sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    let done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    let timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
    if (signal?.aborted) done()
  })

/**
 * Tick immediately, then sleep until the next due instant or the cap,
 * whichever is sooner. A wake whose transaction was rejected on one pass stays
 * due for the next; effects run through the graph. Uses only web timers and
 * `AbortSignal`, available in Deno and Node alike.
 *
 * The first tick happens whatever the signal's state, so one that has already
 * aborted produces exactly one pass — which is how a short-lived process fires
 * what is overdue as it starts up.
 *
 * ```ts
 * import { loop } from '@yaks/wake/deno'
 *
 * let stop = new AbortController()
 * // let running = loop(graph, { signal: stop.signal })
 * // stop.abort()
 * // await running
 * ```
 */
export let loop = async (
  graph: Driver,
  opts: LoopOpts = {},
): Promise<void> => {
  let cap = opts.cap ?? 60_000
  if (!Number.isFinite(cap) || cap <= 0 || cap > 2_147_483_647) {
    throw new RangeError('wake loop cap must be within setTimeout range')
  }
  // ONE PASS FIRST, always: a signal that is already aborted means a
  // short-lived process — a one-off command run to fire whatever is overdue —
  // and it still owes the graph the tick it was started for.
  do {
    let now = Date.now()
    let result = await tick(graph, now)
    await opts.onTick?.(result)
    if (opts.signal?.aborted) break
    // Keep the read at the tick's instant: a wake that became due while an
    // effect ran needs a zero-delay pass, not a whole cap's extra wait.
    let at = await soonest(graph, now)
    await sleep(
      Math.min(cap, Math.max(0, (at ?? Infinity) - Date.now())),
      opts.signal,
    )
  } while (!opts.signal?.aborted)
}
