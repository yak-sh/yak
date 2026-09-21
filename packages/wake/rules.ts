// The graph plugins this package contributes: the module a server imports at
// `@yaks/wake/rules` to get the behaviour a write to the graph gets. It calls
// no handler — `tick` writes `fired` and advances the wake, and the graph's
// other rules do the rest.

import type { Plugin } from '@yaks/graph'
import { wakes } from './plugin.ts'

/** `wake{at, every, target, note}` and the recurrence that moves one on. */
export let rules = (): Plugin[] => [wakes()]
