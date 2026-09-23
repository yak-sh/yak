// The graph plugins this package contributes: the module a server imports at
// `@yaks/edge/rules` to get the behaviour a write to the graph gets. A link's
// eid is derived from its endpoints and relation, so writing the same link
// twice writes one row and removing it clears the components of that same
// entity — behaviour applied at write time, not a component declaration.
//
// The same subpath carries the query half, because a host gathers every read
// path's clause compilers from here (@yaks/cli `RulesFacet`): without it, a
// host that composes this package refuses a walk over a relation and the
// `.edges` rider.

import type { Plugin } from '@yaks/graph'
import type { Extension } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { edges } from './plugin.ts'
import { traverse } from './sql.ts'

/** Derived edge ids, and the relations this vocabulary declares. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [edges(host.vocab)]

/** The walk over a relation and the `.edges` rider, compiled (./sql.ts). */
export let extend = (host: { vocab: Vocab }): Extension[] => [
  traverse(host.vocab),
]
