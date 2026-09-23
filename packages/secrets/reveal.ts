// What trusted code does with a secret: ask for it by name at the moment it is
// used, and get the value — never through the graph, which only ever holds the
// handle, and never through a tool, since a tool's answer is something a
// caller reads. Code that calls out without holding the value asks for the
// sentinel instead (`sentinelOf`), which a swap on the way out replaces.
//
// A name resolves through three places, first match wins:
//
// - the value the vault keeps for it, written through the graph;
// - the `op://` reference the vault keeps instead, read from 1Password now;
// - the environment variable of the same name.
//
// The environment is the fallback, so a secret a service file exports needs
// nothing written anywhere, and writing one through the graph overrides it.
// A secret bound to 1Password never falls through to the environment: a failed
// `op read` is a secret that is missing right now, not an older value.
//
// A 1Password value is kept in memory for half a minute, so a burst of reads is
// one `op` process and a rotation is picked up without a restart. `peek` is
// the same question answered on the spot, for a config read inside a property
// getter: it answers with what is kept, and a 1Password value it has not read
// yet (see `warm`) is fetched for the next asker rather than waited for.

import type { Bundle, Eid } from '@yaks/graph'
import { identityEid, then } from '@yaks/graph'
import { deadline, type OpRead, opRead } from './op.ts'
import { sentinel } from './sentinel.ts'
import type { Local, Vault } from './vault.ts'

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

/** Where else a name may be found, and how 1Password is read. */
export type Sources = {
  env?: (name: string) => string | undefined
  op?: OpRead
}

let environment = (name: string): string | undefined => {
  try {
    return Deno.env.get(name)
  } catch {
    return undefined
  }
}

let TTL = 30_000
let cache = new Map<string, { value: string; until: number }>()
let reading = new Map<string, Promise<string | undefined>>()

// One `op read` per reference at a time, remembered for TTL. A failure forgets
// what was remembered and says why, once per failed read.
let fromOp = (ref: string, read: OpRead): Promise<string | undefined> => {
  let hit = cache.get(ref)
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.value)
  let going = reading.get(ref)
  if (going) return going
  going = read(ref, deadline()).then(
    (value) => {
      cache.set(ref, { value, until: Date.now() + TTL })
      return value
    },
    (e) => {
      cache.delete(ref)
      console.warn('@yaks/secrets — op read failed:', (e as Error).message)
      return undefined
    },
  ).finally(() => reading.delete(ref))
  reading.set(ref, going)
  return going
}

/** A secret's value, by name. */
export let reveal = (
  vault: Vault,
  name: string,
  s: Sources = {},
): string | undefined | Promise<string | undefined> =>
  then(
    vault.read(secretEid(name)),
    (kept) =>
      kept?.value ??
        (kept?.op
          ? fromOp(kept.op, s.op ?? opRead())
          : (s.env ?? environment)(name)),
  )

/** The sentinel for a secret, by name: its handle hashed under the vault's
 * salt (./sentinel.ts). A name nothing was written for has none. */
export let sentinelOf = (
  vault: Vault,
  name: string,
): Promise<string | undefined> =>
  Promise.resolve(vault.read(secretEid(name))).then(async (kept) =>
    kept ? sentinel(await vault.salt(), kept.handle) : undefined
  )

/** The same, answered on the spot. */
export let peek = (
  vault: Local,
  name: string,
  s: Sources = {},
): string | undefined => {
  let kept = vault.read(secretEid(name))
  if (kept?.value != null) return kept.value
  if (!kept?.op) return (s.env ?? environment)(name)
  let hit = cache.get(kept.op)
  if (!hit || hit.until <= Date.now()) void fromOp(kept.op, s.op ?? opRead())
  return hit?.value
}

/** Read every 1Password value a vault is bound to, so a `peek` that follows
 * answers with it. A host calls this once as it starts. */
export let warm = (vault: Vault, s: Sources = {}): Promise<unknown> =>
  Promise.resolve(vault.all()).then((all) =>
    Promise.all(
      all.flatMap(([, kept]) =>
        kept.op && kept.value == null ? [fromOp(kept.op, s.op ?? opRead())] : []
      ),
    )
  )
