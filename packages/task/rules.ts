// What the graph does with a write about a to-do item: the module a server
// imports as `@yaks/task/rules` — the components, and the hook that records who
// completed a task. The status is neither written nor checked here; it is
// computed, and that half is in ./vocab.ts.

import type { Plugin } from '@yaks/graph'
import { tasks } from './plugin.ts'

/** The task components, and the hook that records who completed a task. */
export let rules = (): Plugin[] => [tasks()]
