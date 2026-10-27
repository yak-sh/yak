// Trusted code reads a value from the vault at the moment it uses it. A name
// the vault has no value for falls back to the environment. A kept 1Password
// reference stays unresolved: servers have no 1Password sign-in, and only a
// person's interactive command reads references through opRead.

import type { Bundle, Eid } from '@yaks/graph'
import { after } from '@yaks/fp'
import { identityEid } from '@yaks/graph/identity'
import { isOpRef } from './op.ts'
import { sentinel } from './sentinel.ts'
import type { Local, Sealed, Vault } from './vault.ts'

/** The entity a secret is: its id is derived from its name, so one name is
 * one secret and nobody has to look an id up. */
export let secretEid = (name: string): Eid => identityEid('secret', [name])

/** The bundle that writes a secret: its value, or an `op://` reference. The
 * graph keeps the handle; the vault keeps what it stands for. */
export let sealed = (name: string, value: string): Bundle => ({
  entity: { eid: secretEid(name) },
  secret: { name, value },
})

/** The bundle that forgets one, value and all. */
export let unsealed = (name: string): Bundle => ({
  entity: { eid: secretEid(name) },
  tombstone: {},
})

/** Where a name absent from the vault may be found. */
export type Sources = {
  env?: (name: string) => string | undefined
}

// The process environment, where the runtime has one: a Worker has none.
let environment = (name: string): string | undefined => {
  try {
    return (globalThis as {
      Deno?: { env: { get(name: string): string | undefined } }
    }).Deno?.env.get(name)
  } catch {
    return undefined
  }
}

// An unresolved reference must neither become an outgoing credential nor
// select a different credential from the environment.
let valueOf = (kept: Sealed | undefined, name: string, s: Sources) => {
  if (kept?.op) return undefined
  let value = kept?.value ?? (s.env ?? environment)(name)
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
 * salt (./sentinel.ts). A name nothing was written for has none. */
export let sentinelOf = (
  vault: Vault,
  name: string,
): Promise<string | undefined> =>
  Promise.resolve(vault.read(secretEid(name))).then(async (kept) =>
    kept ? sentinel(await vault.salt(), kept.handle) : undefined
  )

/** A secret's value, by name, answered on the spot. */
export let peek = (
  vault: Local,
  name: string,
  s: Sources = {},
): string | undefined => valueOf(vault.read(secretEid(name)), name, s)
