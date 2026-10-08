// Tests move a fake clock without waiting on a real one.
import { setImmediate } from 'node:timers/promises'
import type { FakeTime } from '@std/testing/time'

/** Settle what is queued, then move the fake clock `ms` on, firing every
 * timer that falls due: `tickAsync`, in microseconds of wall time. Both let
 * the event loop turn first, so every microtask queued runs; `tickAsync`
 * turns it with a real `setTimeout`, which takes a millisecond or two, and
 * this with `setImmediate`, which FakeTime leaves real and which waits on
 * no clock. */
export let pass = async (time: FakeTime, ms = 0) => {
  await setImmediate()
  time.tick(ms)
}
