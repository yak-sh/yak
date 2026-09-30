// What the graph does with a write about a to-do item: the module a server
// imports as `@yaks/task/rules`. The status is neither written nor checked
// here; it is computed, and that half is in ./vocab.ts. Who completed a task is
// kept by @yaks/kernel's rules.

import type { Plugin } from '@yaks/graph'
import { tasks } from './plugin.ts'

/** The task components. */
export let rules = (): Plugin[] => [tasks()]
