// What a batch MEANS about coming back to something later: the `rules` facet a
// host takes (`@yaks/wake/rules`). It fires no handler — `tick` writes `fired`
// and advances the wake, and the graph's other rules do the rest.

import type { Plugin } from '@yaks/graph'
import { wakes } from './plugin.ts'

/** `wake{at, every, target, note}` and the recurrence that moves one on. */
export let rules = (): Plugin[] => [wakes()]
