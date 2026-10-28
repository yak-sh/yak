// The tests' one sanctioned wait. A test never sleeps a fixed span: it yields
// with `tick` and waits on a fact with `until`, both deterministic, so nothing
// pads for a settle that a loaded box would stretch past the pad. Its timeout
// counts the test's own time (./own.ts), so a busy box times out no wait that
// has not hung.
import { own } from './own.ts'

/** One macrotask yield: queued timers and microtasks flush, no span passes. */
export let tick = (): Promise<void> => new Promise((go) => setTimeout(go, 0))

/** How long `until` waits, how often it looks, what it names on a timeout
 * (a string, or a thunk resolved late so it can name live state), and the
 * clock its timeout counts on. */
export type Wait = {
  timeout?: number
  poll?: number
  label?: string | (() => string)
  now?: () => number
}

// The clock a timeout counts on unless told: this runtime's own time and that
// of every process it started, on the clock FakeTime fakes. Without Deno (a
// page, a Worker) it is the wall clock.
let mine = (): () => number =>
  typeof Deno == 'undefined'
    ? () => Date.now()
    : own(Deno.pid, { time: () => Date.now() })

/**
 * Wait for a fact to become true, polling instead of guessing a duration. The
 * timeout only exists to fail instead of hanging; the fact's value comes back.
 *
 * ```ts
 * let n = 0
 * await until(() => ++n == 3) // true
 * ```
 */
export let until = async <T>(
  fact: () => T | Promise<T>,
  { timeout = 2000, poll = 5, label = 'it', now = mine() }: Wait = {},
): Promise<NonNullable<T>> => {
  let deadline = now() + timeout
  while (true) {
    let v = await fact()
    if (v) return v
    // A delayed poll may resume after the fact settled and the deadline.
    if (now() >= deadline) break
    await new Promise((go) => setTimeout(go, poll))
  }
  throw new Error(
    `until: timed out after ${timeout}ms waiting for ${
      typeof label == 'function' ? label() : label
    }`,
  )
}
