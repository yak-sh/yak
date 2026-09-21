// The graph plugin this package contributes, exported as `@yaks/key/rules` —
// the entry point a server imports to install it. A key's eid is
// `sha256("<kind>|<value>")`, so a value is unique within its kind by
// construction.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { keys } from './plugin.ts'

/** Derived key ids, over the kinds this vocabulary declares. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [keys(host.vocab)]
