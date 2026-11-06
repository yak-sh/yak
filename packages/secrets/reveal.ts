// Trusted code reads a value from the vault at the moment it uses it. A name
// the vault has no value for falls back to the source its host lends. A kept
// 1Password reference stays unresolved: servers have no 1Password sign-in, and only a
// person's interactive command reads references through opRead.

import { after } from '@yaks/fp'
import { isOpRef } from './ref.ts'
import { secretEid } from './sealed.ts'
import { sentinel } from './sentinel.ts'
import type { Local, Sealed, Vault } from './vault.ts'

/** Where a name absent from the vault may be found. */
export type Sources = {
  env?: (name: string) => string | undefined
}

// An unresolved reference must neither become an outgoing credential nor
// select a different credential from the environment.
let valueOf = (kept: Sealed | undefined, name: string, s: Sources) => {
  if (kept?.op) return undefined
  let value = kept?.value ?? s.env?.(name)
  return value && isOpRef(value) ? undefined : value
}

/** A secret's value, by name. */
export let reveal = (
  vault: Vault,
  name: string,
  s: Sources = {},
): string | undefined | Promise<string | undefined> =>
  after(vault.read(secretEid(name)), (kept) => valueOf(kept, name, s))

/** The sentinel for a secret, by name: its handle hashed under the vault's
 * salt (./sentinel.ts). A name nothing was written for has none. A secret
 * kept as several named parts (a connection's fields) has one for each
 * `part`, its handle and the part's name hashed together; a handle holds no
 * `#`, so none is another's. */
export let sentinelOf = (
  vault: Vault,
  name: string,
  part?: string,
): Promise<string | undefined> =>
  Promise.resolve(vault.read(secretEid(name))).then(async (kept) =>
    kept
      ? sentinel(
        await vault.salt(),
        part == null ? kept.handle : `${kept.handle}#${part}`,
      )
      : undefined
  )

/** A secret's value, by name, answered on the spot. */
export let peek = (
  vault: Local,
  name: string,
  s: Sources = {},
): string | undefined => valueOf(vault.read(secretEid(name)), name, s)
