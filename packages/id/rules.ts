// The graph plugins this package contributes, exported as `@yaks/id/rules` —
// the entry point a host imports to install them. Two, and a graph may want
// either without the other:
//
//   ids      the id a person typed, resolved to the eid it names (./ids.ts)
//   numbers  the allocator behind `$num: true` (./number.ts), for a graph whose
//            storage numbers on request rather than numbering everything
//
// `numbers` takes the allocator its storage offers, so it is constructed by the
// program that opened the storage rather than by a config file; `ids` is the
// one a config names.

import type { Plugin } from './graph.ts'
import type { Vocab } from '@yaks/vocab'
import { ids } from './ids.ts'
import { numbers } from './number.ts'

export { ids, numbers }

/** Human ids accepted wherever this graph takes an id. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [ids(host.vocab)]
