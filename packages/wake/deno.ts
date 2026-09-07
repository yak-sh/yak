/**
 * A box can sleep until the next wake instead of paying for a fixed heartbeat.
 * The cap lets newly written wakes be noticed without a subscription, and
 * keeps an empty graph and a distant date within setTimeout's range. Stopping
 * aborts only the wait: a graph write already underway finishes its phases.
 * @module
 */

import { soonest } from './due.ts'
import { type Driver, tick, type Ticked } from './tick.ts'

/** The loop's lifetime, polling ceiling, and observer of each tick. */
export type LoopOpts = {
  /** abort to stop the loop and release its timer */
  signal?: AbortSignal
  /** maximum sleep in milliseconds (default one minute); also the retry
   * interval for refused wakes and the delay while the graph is empty */
  cap?: number
  /** observe fired and refused wakes after each tick */
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
 * Tick immediately, then sleep until the next due instant or the cap. A wake
 * refused on one pass stays due for the next; effects run through the graph.
 * Uses only web timers and AbortSignal, available in Deno and Node alike.
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
  while (!opts.signal?.aborted) {
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
  }
}
