// What the page's views share: a property of a bundle as text, and drawing
// again whenever something they watch tells them to.
import { useEffect, useState } from 'preact/hooks'
import type { Bundle } from '@yaks/graph'

/** Draw again whenever `listen` tells. */
export let useTold = (listen: (l: () => void) => () => void) => {
  let [, tick] = useState(0)
  useEffect(() => listen(() => tick((n) => n + 1)), [listen])
}

/** `b[comp][prop]` as text, '' where it has none. */
export let text = (b: Bundle, comp: string, prop: string) =>
  String((b[comp] as Record<string, unknown> | undefined)?.[prop] ?? '')
