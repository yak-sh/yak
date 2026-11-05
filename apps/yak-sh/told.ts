// What the page's views share: a property of a bundle as text, drawing
// again whenever something they watch tells them to, and hearing what is
// clicked inside a drawing.
import { type RefObject } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
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
