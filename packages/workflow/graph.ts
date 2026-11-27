// The graph plugins this package contributes: the module a server imports at
// `@yaks/workflow/graph` to run the graph's steps in its writes.

import type { Plugin } from '@yaks/graph'
import { workflows } from './run.ts'

/** The step runner: in each write, after each commit, and on a firing. */
export let plugins = (): Plugin[] => [workflows()]
