// The graph plugins this package contributes, exported as
// `@yaks/kernel/rules` — the entry point a server imports to install them.
// The kernel registers no write hooks — the `at`/`by`/`via` columns are
// stamped by @yaks/graph's own provenance rules, and `entity.num` is minted by
// storage — so the one thing here is resolving an id a person typed to an eid
// (./ids.ts).

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { ids } from './ids.ts'

export { ids }

/** Human ids accepted wherever this graph takes an id. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [ids(host.vocab)]
