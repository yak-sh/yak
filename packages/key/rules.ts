// What a batch MEANS about a value an entity answers to: the `rules` facet a
// host takes (`@yaks/key/rules`). A key's eid is `sha256("<kind>|<value>")`,
// so a value is unique within its kind by construction.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { keys } from './plugin.ts'

/** Derived key ids, and the kinds this vocabulary declares. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [keys(host.vocab)]
