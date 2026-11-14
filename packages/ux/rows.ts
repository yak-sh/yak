/**
 * The rows a query answers in a page's graph, read live with hooks alone: a
 * domain component asks for the rows it draws, and draws again as they
 * change.
 *
 * @module
 */

import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Bundle } from '@yaks/graph'
import type { Front } from './host.ts'

/** What `query` answers in `front` now, and again each time it changes. */
export let useRows = (front: Front, query: string): Bundle[] => {
  let watch = useMemo(() => front.watch(query), [front, query])
  let [, drew] = useState(0)
  useEffect(() => {
    let off = watch.subscribe(() => drew((n) => n + 1))
    return () => {
      off()
      watch.close?.()
    }
  }, [watch])
  return watch.value
}
