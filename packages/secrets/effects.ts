// What a host does after a secret's write commits: the `@yaks/secrets/effects`
// entry point, the half of this package the plugin in `./rules` needs beside
// it. It seals each written value into the host's vault and drops a deleted
// secret's (./plugin.ts `sealing`).

import type { Watch } from '@yaks/effects'
import { sealing, SECRET } from './plugin.ts'
import type { Vault } from './vault.ts'

/** The value sealed into the host's vault once its write commits. */
export let effects = (host: { vault: Vault }): Watch[] => [
  { comp: SECRET, ...sealing(host.vault) },
]
