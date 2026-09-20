// What a batch MEANS about a to-do item: the `rules` facet a host takes
// (`@yaks/task/rules`) — the components, and the stamp a finished task gets.
// The status is neither written nor ruled on; it is computed, and that half is
// in ./vocab.ts.

import type { Plugin } from '@yaks/graph'
import { tasks } from './plugin.ts'

/** The task words, and the hook that stamps a completion with its author. */
export let rules = (): Plugin[] => [tasks()]
