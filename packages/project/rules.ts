// The graph plugins this package contributes, exported as
// `@yaks/project/rules` — the entry point a server imports to install them.
// They include the check over a board's saved query, which is why this entry
// point needs the vocabulary that query is written against.
//
// The statuses a board may filter on are the ones the loaded VOCABULARY
// declares — each package's `statuses` enum, read as a union — so a server that
// also loads @yaks/session's claim gets `wip` in the check by loading it, and
// one without leases knows only the three @yaks/task declares.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { projects } from './plugin.ts'

/** The project work is filed under, the filing, and the board over it. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [projects(host.vocab)]
