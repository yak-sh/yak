// What a batch MEANS about a portfolio: the `rules` facet a host takes
// (`@yaks/project/rules`) — including the guard over a board's saved query,
// which is why this facet needs the vocabulary the query is written against.
//
// The status ladder a board filters on is the DEFAULT one. A host whose tasks
// are leased reads a held claim as `wip`, and that rung is @yaks/session's;
// composing this facet gives a board the three words @yaks/task ships. A host
// that wants the wider ladder in its board guard composes `projects()` itself.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { projects } from './plugin.ts'

/** The project work is filed under, the filing, and the board over it. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [projects(host.vocab)]
