// The graph plugins this package contributes: the module a server imports at
// `@yaks/alias/rules` to get the behaviour a write to the graph gets. A name is
// a key, so what this adds is @yaks/key's machinery applied to the `alias`
// component.

import type { Plugin } from '@yaks/graph'
import { aliases } from './plugin.ts'

/** Names turned into key entities, and references resolved through them. */
export let rules = (): Plugin[] => [aliases()]
