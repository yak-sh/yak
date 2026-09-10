import { interceptKey } from './keymap.ts'
/**
 * What a widget knows about the screen it is on, and how a key reaches it.
 * Three signals in one place: the terminal's size (a widget that collapses
 * needs it), the measurements the last paint took (a scroll region learns its
 * content height from the painter, since only the painter does layout), and
 * the focus stack — `useKeys` puts a handler on it while mounted, and `press`
 * offers a key to the topmost handler first, walking down until one takes it.
 * Last mounted has focus; a handler that returns anything falsy passes.
 *
 * @module
 */

import { visualKey } from './visual.ts'
import { type Signal, signal } from '@preact/signals'
import { useLayoutEffect, useRef } from 'preact/hooks'
import type { Key } from './input.ts'
import type { Metrics } from './paint.ts'

/** The terminal's size in cells, kept current by `run`. */
export let size: Signal<{ columns: number; rows: number }> = signal({
  columns: 80,
  rows: 24,
})

/** What the last paint measured, per element id. */
export let metrics: Signal<Metrics> = signal<Metrics>({})

/** What a key handler answers: true when it consumed the key. */
export type Keys = (key: Key) => boolean | void

let stack: Keys[] = []
let targets = new Map<string, Keys>()

/** Deliver a command to a named widget without changing keyboard focus. */
export let pressTo = (id: string, key: Key): boolean => !!targets.get(id)?.(key)

/** Offer a key to the focus stack, topmost first. */
export let press = (key: Key): boolean => {
  if (interceptKey(key)) return true
  if (visualKey(key)) return true
  return pressFocused(key)
}

/** Forward an already-routed key to the focused widget stack. */
export let pressFocused = (key: Key): boolean => {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i](key)) return true
  return false
}

/** Take keys while this component is mounted; the newest mount has focus. */
export let useKeys = (fn: Keys, id?: string): void => {
  // The handler closes over this render's state, so the stack holds a stable
  // shim and the shim reads the newest closure — registering the closure
  // itself would reorder focus on every render.
  let ref = useRef(fn)
  ref.current = fn
  // A layout effect, not an effect: outside a browser Preact defers effects
  // to a frame that may be 100ms away, and a key pressed before then would
  // reach nobody.
  useLayoutEffect(() => {
    let shim: Keys = (k) => ref.current(k)
    stack.push(shim)
    return () => {
      stack.splice(stack.indexOf(shim), 1)
    }
  }, [])
  useLayoutEffect(() => {
    if (!id) return
    let shim: Keys = (k) => ref.current(k)
    targets.set(id, shim)
    return () => { if (targets.get(id) === shim) targets.delete(id) }
  }, [id])
}

/** What the painter measured for an element id on the last paint. */
export let useMetric = (
  id: string,
): { total: number; height: number; width: number } =>
  metrics.value[id] ?? { total: 0, height: 0, width: 0 }

/** Publish a paint's measurements; unchanged measurements re-render nothing. */
export let measured = (next: Metrics): void => {
  let now = metrics.value
  let same = Object.keys(next).length == Object.keys(now).length &&
    Object.entries(next).every(([k, v]) =>
      now[k]?.total == v.total && now[k]?.height == v.height &&
      now[k]?.width == v.width
    )
  if (!same) metrics.value = next
}

/** Forget the focus stack — for a test that mounts more than one app. */
export let clear = (): void => void (stack.length = 0)
