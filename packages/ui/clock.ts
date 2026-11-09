/** The minute clock shared by mounted date faces, stopped with the last one.
 * @module
 */
import { type Signal, signal } from '@preact/signals'
import { useLayoutEffect } from 'preact/hooks'
import { type Clock, system } from '@yaks/fp'

type Ticker = { at: Signal<number>; readers: number; cancel?: () => void }
let clocks = new WeakMap<Clock, Ticker>()
let ticker = (clock: Clock) => {
  let t = clocks.get(clock)
  if (!t) clocks.set(clock, t = { at: signal(clock.now()), readers: 0 })
  return t
}
let start = (clock: Clock, t: Ticker): void => {
  t.at.value = clock.now()
  t.cancel = clock.after(60_000, () => start(clock, t))
}

/** A host clock, subscribed only while the date is mounted. */
export let useNow = (clock: Clock = system): number => {
  let t = ticker(clock)
  useLayoutEffect(() => {
    if (!t.readers++) start(clock, t)
    return () => {
      if (!--t.readers) t.cancel?.()
    }
  }, [clock])
  let now = t.at.value
  return t.readers ? now : clock.now()
}
