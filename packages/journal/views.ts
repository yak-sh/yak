/**
 * What the browsing app draws from this package: the History page, which
 * the sidebar offers over the days' measurements. The page is loaded when
 * first drawn (./page.ts).
 *
 * @module
 */
import type { View } from '@yaks/inspect'
import History from 'lucide/dist/esm/icons/rotate-ccw-clock.mjs'

/** The page, loaded when first drawn. */
export let inspectViews = (): Promise<View[]> =>
  import('./page.ts').then((m) => m.inspectViews)

/** The page the sidebar offers: what history keeps, over the days. */
export let destinations = [
  {
    key: 'history',
    name: 'History',
    icon: 'history',
    query: '.kept * .order=-kept.day',
    view: 'History.Page',
  },
]

/** The glyph it wears there. */
export let icons = { history: History }
