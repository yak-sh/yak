// The `@yaks/workflow/views` facet: a workflow's page (./inspect.ts), loaded
// only by an interface that draws it; the tab a workflow opens on; and the
// page the sidebar offers, every workflow.
import type { View } from '@yaks/inspect'

/** A workflow's page, as the inspector draws it. */
export let inspectViews = (): Promise<View[]> =>
  import('./inspect.ts').then((m) => m.inspectViews)

/** The tab a workflow wears, so it opens on its map and cases. */
export let tabs = [{ view: 'Workflow', icon: 'workflow' }]

/** The page the sidebar offers: every workflow, newest first. */
export let destinations = [
  {
    key: 'workflows',
    name: 'Workflows',
    icon: 'workflow',
    query: '.workflow * .order=-created.at',
  },
]
