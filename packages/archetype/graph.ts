// The graph plugins this package contributes: the module a server imports at
// `@yaks/archetype/graph`. It keeps each entity's archetype up to date as that
// entity gains and loses components, wherever its store keeps them: a store
// read as of a transaction or on a branch (@yaks/sqlite `moded`) says it keeps
// none, since a pointer says what an entity holds on main now.

import type { Plugin } from '@yaks/graph'
import { archetypes } from './plugin.ts'

/** Each entity's archetype, maintained as its components come and go. */
export let plugins = (
  host?: { storage?: { statements?: { mode?: object } } },
): Plugin[] => host?.storage?.statements?.mode ? [] : [archetypes()]
