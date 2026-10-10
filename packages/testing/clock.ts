// A virtual clock runs scheduled callbacks only when a test advances time.
// Consumers inject its operations at their timer boundary.

/** A clock whose time and scheduled callbacks are controlled by the caller. */
export type Clock = {
  now: () => number
  after: (ms: number, callback: () => void | Promise<void>) => () => void
  advance: (ms: number) => Promise<void>
}

/** Create a virtual clock at a chosen time, in milliseconds. */
export let clock = (start = 0): Clock => {
  let time = start
  let next = 0
  let pending = new Map<number, {
    at: number
    callback: () => void | Promise<void>
  }>()
  return {
    now: () => time,
    after: (ms, callback) => {
      let id = next++
      pending.set(id, { at: time + Math.max(0, ms), callback })
      return () => {
        pending.delete(id)
      }
    },
    advance: async (ms) => {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError(
          'clock: advance requires a finite, nonnegative span',
        )
      }
      let end = time + ms
      while (true) {
        let due: number | undefined
        for (let [id, timer] of pending) {
          if (
            timer.at <= end &&
            (due === undefined || timer.at < pending.get(due)!.at)
          ) due = id
        }
        if (due === undefined) break
        let timer = pending.get(due)!
        pending.delete(due)
        time = timer.at
        await timer.callback()
      }
      time = end
    },
  }
}
