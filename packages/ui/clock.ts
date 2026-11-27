/** The clocks shared by mounted date faces, one for each pace they read it at,
 * each stopped with the last face reading it.
 * @module
 */
import { useStore } from './store.ts'
import { useCallback } from 'react'
import { type Clock, system } from '@yaks/fp'

type Ticker = { at: number; readers: Set<() => void>; cancel?: () => void }
let clocks = new WeakMap<Clock, Map<number, Ticker>>()
let ticker = (clock: Clock, every: number) => {
  let paces = clocks.get(clock)
  if (!paces) clocks.set(clock, paces = new Map())
  let t = paces.get(every)
  if (!t) paces.set(every, t = { at: clock.now(), readers: new Set() })
  // Nobody reads a stopped clock: what a face reads first is the time now.
  else if (!t.readers.size) t.at = clock.now()
  return t
}
let start = (clock: Clock, every: number, t: Ticker): void => {
  t.at = clock.now()
  for (let wake of [...t.readers]) wake()
  t.cancel = clock.after(every, () => start(clock, every, t))
}

/** A host clock read `every` so many milliseconds (a minute unless said),
 * subscribed only while the date is mounted. */
export let useNow = (clock: Clock = system, every = 60_000): number => {
  let t = ticker(clock, every)
  let subscribe = useCallback((wake: () => void) => {
    t.readers.add(wake)
    if (t.readers.size == 1) start(clock, every, t)
    return () => {
      t.readers.delete(wake)
      if (!t.readers.size) t.cancel?.()
    }
  }, [t])
  return useStore(subscribe, () => t.at)
}
