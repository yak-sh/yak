// What a batch MEANS on a canvas: the `rules` facet a host takes
// (`@yaks/canvas/rules`).

import type { Plugin } from '@yaks/graph'
import { canvas } from './plugin.ts'

/** Cards, pins, cameras and the per-client state a canvas keeps. */
export let rules = (): Plugin[] => [canvas()]
