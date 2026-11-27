/**
 * The rows a query answers in a page's graph, read live with hooks alone: a
 * domain component asks for the rows it draws, and draws again as they
 * change.
 *
 * @module
 */

import { useStore } from '@yaks/ui/store'
import { useCallback, useEffect, useMemo } from 'react'
import type { Bundle } from '@yaks/graph'
import type { Front } from './host.ts'

/** What `query` answers in `front` now, and again each time it changes. */
export let useRows = (front: Front, query: string): Bundle[] => {
  let watch = useMemo(() => front.watch(query), [front, query])
  useEffect(() => () => watch.close?.(), [watch])
  let subscribe = useCallback(
    (wake: () => void) => watch.subscribe(wake),
    [watch],
  )
  return useStore(subscribe, () => watch.value)
}

/** Read an observable snapshot and subscribe while the component is mounted. */
export let useObserved = <T>(source: {
  peek: () => T
  subscribe: (changed: () => void) => () => void
}): T => {
  let subscribe = useCallback(
    (changed: () => void) => source.subscribe(changed),
    [source],
  )
  return useStore(subscribe, () => source.peek())
}
