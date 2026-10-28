// Tests move a clock of their own (@yaks/testing `clock()`) without waiting on
// a real one.
import type { Clock } from '@yaks/testing'

/** `time` as a `setTimeout`-shaped timer seam (@yaks/api and @yaks/client
 * `timer`): `fn` after `ms`, returning its cancel. */
export let timer = (time: Clock) => (fn: () => void, ms: number) =>
  time.after(ms, fn)
