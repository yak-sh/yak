// The tests' one sanctioned wait. A test never sleeps a fixed span: it yields
// with `tick` and waits on a fact with `until`, both deterministic, so nothing
// pads for a settle that a loaded box would stretch past the pad.

/** One macrotask yield: queued timers and microtasks flush, no span passes. */
export let tick = (): Promise<void> => new Promise((go) => setTimeout(go, 0))

/** How long `until` waits, how often it looks, and what it names on a
 * timeout: a string, or a thunk resolved late so it can name live state. */
export type Wait = {
  timeout?: number
  poll?: number
  label?: string | (() => string)
}

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
  { timeout = 2000, poll = 5, label = 'it' }: Wait = {},
): Promise<NonNullable<T>> => {
  let deadline = Date.now() + timeout
  while (true) {
    let v = await fact()
    if (v) return v
    // A delayed poll may resume after the fact settled and the deadline.
    if (Date.now() >= deadline) break
    await new Promise((go) => setTimeout(go, poll))
  }
  throw new Error(
    `until: timed out after ${timeout}ms waiting for ${
      typeof label == 'function' ? label() : label
    }`,
  )
}
