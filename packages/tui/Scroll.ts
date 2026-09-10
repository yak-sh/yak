/**
 * A scrollable region — the transcript. The component holds one number, the
 * offset it hands the painter as a `scroll` attribute; the painter hands back
 * how tall the content turned out to be, which is the only way a widget can
 * know. Follows the bottom while it is at the bottom, and stops following the
 * moment you scroll away — so a transcript that is growing stays pinned and a
 * transcript you are reading holds still.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { MouseEvent } from './mouse.ts'
import type { Key } from './input.ts'
import { useKeys, useMetric } from './screen.ts'

/** What a scroll region measured: content lines, and the rows it can show. */
export type View = { total: number; height: number }

/** How far a wheel notch moves. */
let WHEEL = 3

/** The offset a key moves to, or null when the key does not scroll. */
export let scrolled = (top: number, key: Key, v: View): number | null => {
  let page = Math.max(1, v.height - 1)
  let to = key.name == 'up'
    ? top - 1
    : key.name == 'down'
    ? top + 1
    : key.name == 'wheelup'
    ? top - WHEEL
    : key.name == 'wheeldown'
    ? top + WHEEL
    : key.name == 'pageup'
    ? top - page
    : key.name == 'pagedown'
    ? top + page
    : key.name == 'home' && key.ctrl
    ? 0
    : key.name == 'end' && key.ctrl
    ? v.total
    : null
  if (to == null) return null
  return Math.min(Math.max(0, to), Math.max(0, v.total - v.height))
}

/** A scrolling window over its children. `id` is how the painter reports it. */
export let Scroll = (
  { id, follow = true, scrollbar = false, children, ...rest }: {
    id: string
    scrollbar?: boolean
    follow?: boolean
    children?: ComponentChildren
    [attr: string]: unknown
  },
): JSX.Element => {
  let v = useMetric(id)
  let max = Math.max(0, v.total - v.height)
  let [top, setTop] = useState(0)
  let [stick, setStick] = useState(follow)
  // A held page key arrives as several keys in one read, before any re-render:
  // the handler moves from this ref so each one starts where the last ended.
  let live = useRef(top)
  live.current = top
  useKeys((key) => {
    let to = scrolled(live.current, key, v)
    if (to == null) return false
    live.current = to
    setStick(to >= max)
    setTop(to)
    return true
  })
  // A different id is a different transcript, without remounting the key
  // handler above the editor in the focus stack.
  useLayoutEffect(() => {
    live.current = 0
    setTop(0)
    setStick(follow)
  }, [id, follow])
  // Content grew while pinned to the bottom: follow it there. Setting the same
  // offset renders nothing, so this settles after one paint.
  useLayoutEffect(() => {
    if (stick && top != max) setTop(max)
  })
  return h('div', {
    ...rest,
    id,
    scroll: String(Math.min(top, max)),
    'scroll-snapped': stick ? '1' : undefined,
    scrollbar: scrollbar ? '1' : undefined,
    onWheel: (event: MouseEvent) => {
      if (
        !event.deltaY || event.release || event.ctrl || event.alt || event.shift
      ) return
      let to = Math.max(0, Math.min(max, live.current + event.deltaY * WHEEL))
      if (to == live.current) return
      live.current = to
      setStick(to >= max)
      setTop(to)
      event.preventDefault()
    },
  }, children)
}
