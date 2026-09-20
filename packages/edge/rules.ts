// What a batch MEANS about a link: the `rules` facet a host takes
// (`@yaks/edge/rules`). An edge's eid is derived from the sentence it states,
// so stating one twice writes one row and unlinking is a tombstone of that
// eid — which is a rule about a batch, not a word in a vocabulary.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { edges } from './plugin.ts'

/** Derived edge ids, and the relations this vocabulary declares. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [edges(host.vocab)]
