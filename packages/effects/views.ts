// The `@yaks/effects/views` facet: the page the sidebar offers as Effects
// (./page.ts), loaded only by an interface that draws it.
import type { View } from '@yaks/inspect'
import Gauge from 'lucide/dist/esm/icons/gauge.mjs'

/** The page, as the inspector draws it. */
export let inspectViews = (): Promise<View[]> =>
  import('./page.ts').then((m) => m.inspectViews)

/** The page the sidebar offers: the workers, what each is running and how
 * busy it is, and the runs owed behind them. */
export let destinations = [
  { key: 'effects', name: 'Effects', icon: 'gauge', view: 'Effects.Page' },
]

/** The glyph it wears there. */
export let icons = { gauge: Gauge }
