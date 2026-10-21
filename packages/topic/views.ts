// The `@yaks/topic/views` facet: the shelves of topics, a topic's page and
// tree, loaded only by an interface that draws them (./inspect.ts); the tabs a
// topic opens on; and the page the sidebar offers, every topic on its shelf.
import type { View } from '@yaks/inspect'
import Library from 'lucide/dist/esm/icons/library-big.mjs'

/** The shelves, the page, the tree and a topic's tile, as the inspector
 * draws them. */
export let inspectViews = (): Promise<View[]> =>
  import('./inspect.ts').then((m) => m.inspectViews)

/** The tabs a topic wears, its page first, so it opens on its page. */
export let tabs = [
  { view: 'Topic', icon: 'book-open' },
  { view: 'Tree', icon: 'workflow' },
]

/** The page the sidebar offers: every topic on its shelf, and the field that
 * finds one. */
export let destinations = [
  { key: 'topics', name: 'Topics', icon: 'library-big', view: 'Topics.Page' },
]

/** The glyph it wears there. */
export let icons = { 'library-big': Library }
