// The graph plugins this package contributes: the module a server imports at
// `@yaks/archetype/rules`. It keeps each entity's archetype up to date as that
// entity gains and loses components.

import type { Plugin } from '@yaks/graph'
import { archetypes } from './plugin.ts'

/** Each entity's archetype, maintained as its components come and go. */
export let rules = (): Plugin[] => [archetypes()]
