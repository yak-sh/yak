// What a batch MEANS about a page: the `rules` facet a host takes
// (`@yaks/page/rules`). An address is canonicalized on the way in, and the
// entity it names follows from that — which is a rule about a batch, not a
// word in a vocabulary.

import type { Plugin } from '@yaks/graph'
import { pages } from './plugin.ts'

/** The page words, and the canonical address. */
export let rules = (): Plugin[] => [pages()]
