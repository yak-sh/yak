// What the base words MEAN to a batch: the `rules` facet a host takes
// (`@yaks/kernel/rules`). The kernel declares no hooks — the stamps are the
// store's — so the one thing here is how an id a person typed becomes an eid
// (./ids.ts).

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { ids } from './ids.ts'

export { ids }

/** Human ids at every door of this graph. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [ids(host.vocab)]
