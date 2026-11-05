// What the page's views share: a property of a bundle as text, drawing
// again whenever something they watch tells them to, hearing what is clicked
// inside a drawing, and how far down a list the reader has scrolled.
import { type RefObject } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Bundle } from '@yaks/graph'
import { LINE } from './figure.ts'

/** Draw again whenever `listen` tells. */
export let useTold = (listen: (l: () => void) => () => void) => {
  let [, tick] = useState(0)
  useEffect(() => listen(() => tick((n) => n + 1)), [listen])
}

/** `b[comp][prop]` as text, '' where it has none. */
export let text = (b: Bundle, comp: string, prop: string) =>
  String((b[comp] as Record<string, unknown> | undefined)?.[prop] ?? '')

/** Hear `types` on the element `ref` holds, with the newest `fn`: a drawing
 * hears every click in it on itself, whoever drew the markup inside. */
export let useHeard = (
  ref: RefObject<Element>,
  types: string[],
  fn: (ev: Event) => void,
) => {
  let latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    let el = ref.current
    if (!el) return
    let on = (ev: Event) => latest.current(ev)
    for (let t of types) el.addEventListener(t, on)
    return () => {
      for (let t of types) el.removeEventListener(t, on)
    }
  }, [])
}

/** The index of the last of `tops` above `line`: how far down a list the
 * reader is, -1 before its first. */
export let passed = (tops: number[], line: number) =>
  tops.reduce((k, top, i) => top < line ? i : k, -1)

/** How far down the list `ref` holds the reader is: the index of the last of
 * its `.Dot`s above the reading line, measured each frame they scroll and
 * told to `each`; `fallback` where nothing measures, as in a test. */
export let useReached = (
  ref: RefObject<Element>,
  fallback: number,
  each?: (k: number) => void,
) => {
  let [upto, set] = useState(fallback)
  let latest = useRef(each)
  latest.current = each
  useLayoutEffect(() => {
    let list = ref.current
    if (!list || typeof requestAnimationFrame == 'undefined') return
    let frame = 0
    let measure = () => {
      frame = 0
      let tops = [...list.querySelectorAll('.Dot')]
        .map((d) => d.getBoundingClientRect().top + 4)
      let k = passed(tops, innerHeight * LINE)
      set(k)
      latest.current?.(k)
    }
    let soon = () => frame ||= requestAnimationFrame(measure)
    addEventListener('scroll', soon, { passive: true })
    addEventListener('resize', soon)
    measure()
    return () => {
      removeEventListener('scroll', soon)
      removeEventListener('resize', soon)
      cancelAnimationFrame(frame)
    }
  }, [])
  return upto
}
