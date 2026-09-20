// What a batch MEANS about the words a person reads: the `rules` facet a host
// takes (`@yaks/doc/rules`).

import type { Plugin } from '@yaks/graph'
import { docs as plugin } from './plugin.ts'

/** `doc{title, body}`, as a graph plugin. */
export let rules = (): Plugin[] => [plugin()]
