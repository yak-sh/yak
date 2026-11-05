// What the page's views share: a property of a bundle as text, drawing
// again whenever something they watch tells them to, hearing what is clicked
// inside a drawing, and how far down a list the reader has scrolled.
import { type RefObject } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Bundle } from '@yaks/graph'

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

/** How far into the window, from its top and from its bottom, a trigger
 * is before it is live: it starts this far after it comes in, and is done
 * this far before it goes out. */
export const BUFFER = .1

let clamp = (v: number) => Math.max(0, Math.min(1, v))

/**
 * The scrolling each trigger gets, from where their tops sit in the window
 * now, in order down the page. A trigger is live while its top is between
 * `bottom` and `top` (the window's lines it starts and finishes at), and
 * triggers live at the same time divide that scrolling between them, one
 * after another, as evenly as each one's own stretch allows: so all of it is
 * used, and only scrolling where no trigger is live does nothing. Each share
 * is `[start, end]`: how far the page has to scroll from here for it to
 * start and to finish, so one already under way starts below 0.
 */
export let allot = (
  tops: number[],
  top: number,
  bottom: number,
): [number, number][] => {
  let from = tops.map((t) => t - bottom)
  let to = tops.map((t) => t - top)
  let shares: [number, number][] = []
  for (let i = 0; i < tops.length;) {
    // A run of triggers each live before the one before it is done.
    let j = i
    while (j + 1 < tops.length && from[j + 1] <= to[j]) j++
    let n = j - i + 1
    let start = from[i], end = to[j]
    // Where each hands over to the next: as even as the stretches allow,
    // settled by averaging each with its neighbours within its bounds.
    let cut = Array.from(
      { length: n + 1 },
      (_, k) => start + (end - start) * k / n,
    )
    let bound = (k: number, at: number) =>
      Math.max(from[i + k], Math.min(to[i + k - 1], at))
    for (let k = 1; k < n; k++) cut[k] = bound(k, cut[k])
    for (let round = 0; round < n * n; round++) {
      for (let k = 1; k < n; k++) {
        cut[k] = bound(k, (cut[k - 1] + cut[k + 1]) / 2)
      }
    }
    for (let k = 0; k < n; k++) shares.push([cut[k], cut[k + 1]])
    i = j + 1
  }
  return shares
}

/** How far each trigger has played, 0 to 1, from where their tops sit in a
 * window `view` tall, given the scrolling `allot` gives it; the lines it is
 * live between are BUFFER in from the window's edges, unless `top` says the
 * window is covered above it. Scrolling back plays it backwards. */
export let played = (
  tops: number[],
  view: number,
  top = view * BUFFER,
): number[] =>
  allot(tops, top, view * (1 - BUFFER)).map(([start, end]) =>
    clamp(-start / Math.max(1, end - start))
  )

/** How far down the list `ref` holds the reader is: the index of the last of
 * its `.Dot`s to have started, -1 before its first, measured each frame they
 * scroll and told to `each`; `fallback` where nothing measures, as in a
 * test. How far that one has played, 0 to 1, is `--p` on the band the list
 * is in, so what the step shows plays out as they scroll, and backwards as
 * they go back. */
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
      let p = played(tops, innerHeight)
      let k = p.findLastIndex((x) => x > 0)
      list.closest<HTMLElement>('.Band')?.style.setProperty(
        '--p',
        (p[k] ?? 0).toFixed(3),
      )
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
