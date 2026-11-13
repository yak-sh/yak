/** The clocks shared by mounted date faces, one for each pace they read it at,
 * each stopped with the last face reading it.
 * @module
 */
import { type Signal, signal } from '@preact/signals'
import { useLayoutEffect } from 'preact/hooks'
import { type Clock, system } from '@yaks/fp'

type Ticker = { at: Signal<number>; readers: number; cancel?: () => void }
let clocks = new WeakMap<Clock, Map<number, Ticker>>()
let ticker = (clock: Clock, every: number) => {
  let paces = clocks.get(clock)
  if (!paces) clocks.set(clock, paces = new Map())
  let t = paces.get(every)
  if (!t) paces.set(every, t = { at: signal(clock.now()), readers: 0 })
  return t
}
let start = (clock: Clock, every: number, t: Ticker): void => {
  t.at.value = clock.now()
  t.cancel = clock.after(every, () => start(clock, every, t))
}

/** A host clock read `every` so many milliseconds (a minute unless said),
 * subscribed only while the date is mounted. */
export let useNow = (clock: Clock = system, every = 60_000): number => {
  let t = ticker(clock, every)
  useLayoutEffect(() => {
    if (!t.readers++) start(clock, every, t)
    return () => {
      if (!--t.readers) t.cancel?.()
    }
  }, [clock, every])
  let now = t.at.value
  return t.readers ? now : clock.now()
}
