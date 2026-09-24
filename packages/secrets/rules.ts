// The graph plugin this package contributes, exported as
// `@yaks/secrets/rules` — the entry point a host imports to install it, over
// the vault the host keeps (@yaks/cli keeps one beside its database). Its
// other half, the seal after the commit, is `./effects`.

import type { Plugin } from '@yaks/graph'
import { secrets } from './plugin.ts'
import type { Vault } from './vault.ts'

/** Secrets sealed out of every write, into the host's vault. */
export let rules = (host: { vault: Vault }): Plugin[] => [secrets(host.vault)]
