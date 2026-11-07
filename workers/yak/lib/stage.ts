// A store's stages: its start, which runs once and holds every request that
// arrives before it finishes, and the clock on a start, a settle or a replay,
// which says when one was slow. Each holds whatever arrives behind it, and is
// the first suspect when a store answers slowly: a directory once stalled 41 s
// after Cloudflare moved it and nothing said what its new instance was doing
// (T-131928).

/** A stage that took at least this many milliseconds is slow. */
export let SLOW = 1000

/** Work run once until forgotten, and whether a caller arriving now waits on
 * it: one that arrives before it began, or while it runs. */
export type Once = {
  /** The run, once one has begun. */
  readonly ran: Promise<void> | null
  /** Whether a caller arriving now waits on the run. */
  readonly holds: boolean
  /** Runs `work`, unless a run began already, and waits for that run. */
  run(work: () => Promise<void>): Promise<void>
  /** Forgets the run, so the next caller runs it again. */
  forget(): void
}

export let once = (): Once => {
  let ran: Promise<void> | null = null, done = false
  return {
    get ran() {
      return ran
    },
    get holds() {
      return !done
    },
    run(work) {
      if (ran) return ran
      let mine: Promise<void> = ran = work().finally(() => {
        if (ran == mine) done = true
      })
      return mine
    },
    forget() {
      ran = null
      done = false
    },
  }
}

/** `work`, timed on `now`, and `slow` told how long it took when that was
 * `SLOW` or more, whether it finished or threw. */
export let timed = async <T>(
  now: () => number,
  work: () => Promise<T>,
  slow: (ms: number) => void,
): Promise<T> => {
  let at = now()
  try {
    return await work()
  } finally {
    let ms = now() - at
    if (ms >= SLOW) slow(ms)
  }
}
