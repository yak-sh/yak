// The `@yaks/topic/views` facet: a topic's page and tree, loaded only by an
// interface that draws them (./inspect.ts), and the tabs a topic opens on.
import type { View } from '@yaks/inspect'

/** The page, the tree and a topic's tile, as the inspector draws them. */
export let inspectViews = (): Promise<View[]> =>
  import('./inspect.ts').then((m) => m.inspectViews)

/** The tabs a topic wears, its page first, so it opens on its page. */
export let tabs = [
  { view: 'Topic', icon: 'book-open' },
  { view: 'Tree', icon: 'workflow' },
]
