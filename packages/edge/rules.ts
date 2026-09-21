// The graph plugins this package contributes: the module a server imports at
// `@yaks/edge/rules` to get the behaviour a write to the graph gets. A link's
// eid is derived from its endpoints and relation, so writing the same link
// twice writes one row and removing it clears the components of that same
// entity — behaviour applied at write time, not a component declaration.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { edges } from './plugin.ts'

/** Derived edge ids, and the relations this vocabulary declares. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [edges(host.vocab)]
