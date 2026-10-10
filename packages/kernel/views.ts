// Component faces are loaded only by a browser or terminal painter.
import type { Bundle } from '@yaks/graph'
import type { ComponentRenderer } from '@yaks/preact'

export let componentViews = (): Promise<
  { renderers: ComponentRenderer<Bundle>[] }
> => import('./component-views.tsx').then((m) => m.views)
