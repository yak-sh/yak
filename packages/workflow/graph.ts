// The graph plugins this package contributes: the module a server imports at
// `@yaks/workflow/graph` to run the graph's steps in its writes.

import type { Plugin } from '@yaks/graph'
import { type Report, workflows } from './run.ts'

/** The step runner: in each write, after each commit, and on a firing. A
 * step that cannot run is the host's to report. */
export let plugins = (host: { report?: Report } = {}): Plugin[] => [
  workflows(host.report),
]
