// What a batch MEANS about the set of tables an entity occupies: the `rules`
// facet a host takes (`@yaks/archetype/rules`).

import type { Plugin } from '@yaks/graph'
import { archetypes } from './plugin.ts'

/** Each entity's archetype, maintained as its components come and go. */
export let rules = (): Plugin[] => [archetypes()]
