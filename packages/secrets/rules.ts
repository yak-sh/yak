// The graph plugin this package contributes, exported as
// `@yaks/secrets/rules` — the entry point a host imports to install it, over
// the vault beside the host's own database (./home.ts).

import type { Plugin } from '@yaks/graph'
import { vaultOf } from './home.ts'
import { secrets } from './plugin.ts'

/** Secrets sealed out of every write, into the vault beside the database. */
export let rules = (host: { config: { db?: string } }): Plugin[] => [
  secrets(vaultOf(host.config)),
]
