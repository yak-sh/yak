// What a batch MEANS about a portfolio: the `rules` facet a host takes
// (`@yaks/project/rules`) — including the guard over a board's saved query,
// which is why this facet needs the vocabulary the query is written against.
//
// The status ladder a board filters on is the one the loaded VOCABULARY
// declares — each package's `statuses` enum, read as a union — so a host that
// composes @yaks/session's claim gets `wip` in its board guard by composing
// it, and a host without leases still knows only the three @yaks/task ships.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { projects } from './plugin.ts'

/** The project work is filed under, the filing, and the board over it. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [projects(host.vocab)]
