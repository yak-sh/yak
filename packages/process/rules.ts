// What a batch MEANS about a running program: the `rules` facet a host takes
// (`@yaks/process/rules`).

import type { Plugin } from '@yaks/graph'
import { processes } from './plugin.ts'

/** `process`, `service` and `exit`, as a graph plugin. */
export let rules = (): Plugin[] => [processes()]
