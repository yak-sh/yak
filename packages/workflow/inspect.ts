// What this package draws, as @yaks/render registrations: a workflow's page,
// its map and its cases, as the tab a workflow opens on (`Workflow`) and
// wherever a page is asked for (`Inspect.Page`). Loaded only by an interface
// that draws them (./views.ts).

import { parse } from '@yaks/query'
import type { View } from '@yaks/inspect'
import { asks, WorkflowPage } from './page.ts'

let workflow = parse('.workflow')

/** The views this package draws. */
export let inspectViews: View[] = [
  { view: 'Workflow', match: workflow, asks, Render: WorkflowPage },
  { view: 'Inspect.Page', match: workflow, asks, Render: WorkflowPage },
]
