// The graph plugin this package contributes, exported as
// `@yaks/secrets/rules` — the entry point a host imports to install it, over
// the vault the host keeps (@yaks/cli keeps one beside its database). It takes
// a value out of a write before anything stores it, and seals it into the
// vault once the write commits (./plugin.ts).

import type { Graph, Plugin } from '@yaks/graph'
import { secrets } from './plugin.ts'
import type { Vault } from './vault.ts'

/** Secrets sealed out of every write, into the host's vault. */
export let rules = (host: { vault: Vault; graph: Graph }): Plugin[] => [
  secrets(host.vault, (b) => host.graph.apply(b, { trusted: true })),
]
