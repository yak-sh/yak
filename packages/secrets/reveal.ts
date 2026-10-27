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
// one `op` process and a rotation is picked up without a restart. A failed read
// is kept as long, so a secret 1Password refuses is not asked for again by
// every reader, and is reported once, to the reporter a host installed
// (`faults`), until a read of it succeeds again.
//
// `peek` is the same question answered on the spot, for a config read inside a
// property getter. A 1Password value this process has never read is read before
// it answers, so 1Password is asked only by a process that uses the secret, and
// never by every process that merely names it; one read before is answered at
// once, and read again behind the answer once it is half a minute old.

import type { Bundle, Eid } from '@yaks/graph'
import { after } from '@yaks/fp'
import { identityEid } from '@yaks/graph/identity'
import {
  deadline,
  type OpRead,
  opRead,
  type OpReadNow,
  opReadNow,
} from './op.ts'
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

/** Where else a name may be found, and how 1Password is read: awaited, and on
 * the spot. */
export type Sources = {
  env?: (name: string) => string | undefined
  op?: OpRead
  opNow?: OpReadNow
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

// Where a failed read is told: the reporter a host installed last, else the
// console.
let reporters: ((error: unknown, where: string) => void)[] = []

/** Report every 1Password read this process fails to `report`, with where it
 * was caught: the host's own reporter, which tells its tracker. A reference
 * that keeps failing is told once, until it reads again. The newest installed
 * is the one told; the function returned removes it. */
export let faults = (
  report: (error: unknown, where: string) => void,
): () => void => {
  reporters.push(report)
  return () => {
    let at = reporters.lastIndexOf(report)
    if (at >= 0) reporters.splice(at, 1)
  }
}

let TTL = 30_000
// What each reference last read as, for TTL: its value, or none for a failure.
let cache = new Map<string, { value?: string; until: number }>()
let reading = new Map<string, Promise<string | undefined>>()
let failing = new Set<string>()

let answered = (ref: string, value: string): string => {
  cache.set(ref, { value, until: Date.now() + TTL })
  failing.delete(ref)
  return value
}

let failed = (ref: string, name: string, e: unknown): undefined => {
  cache.set(ref, { until: Date.now() + TTL })
  if (failing.has(ref)) return
  failing.add(ref)
  let error = new Error(
    `${name} could not be read from 1Password: ${(e as Error).message}`,
    { cause: e },
  )
  let report = reporters.at(-1)
  let said = () => console.warn('@yaks/secrets —', error.message)
  try {
    if (report) report(error, 'op read')
    else said()
  } catch {
    said()
  }
}

// One `op read` per reference at a time, remembered for TTL.
let fromOp = (
  ref: string,
  name: string,
  read: OpRead,
): Promise<string | undefined> => {
  let hit = cache.get(ref)
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.value)
  let going = reading.get(ref)
  if (going) return going
  going = read(ref, deadline()).then(
    (value) => answered(ref, value),
    (e) => failed(ref, name, e),
  ).finally(() => reading.delete(ref))
  reading.set(ref, going)
  return going
}

// The same read, answered before it returns.
let fromOpNow = (
  ref: string,
  name: string,
  read: OpReadNow,
): string | undefined => {
  try {
    return answered(ref, read(ref))
  } catch (e) {
    return failed(ref, name, e)
  }
}

/** A secret's value, by name. */
export let reveal = (
  vault: Vault,
  name: string,
  s: Sources = {},
): string | undefined | Promise<string | undefined> =>
  after(
    vault.read(secretEid(name)),
    (kept) =>
      kept?.value ??
        (kept?.op
          ? fromOp(kept.op, name, s.op ?? opRead())
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

/** A secret's value, by name, answered on the spot. */
export let peek = (
  vault: Local,
  name: string,
  s: Sources = {},
): string | undefined => {
  let kept = vault.read(secretEid(name))
  if (kept?.value != null) return kept.value
  if (!kept?.op) return (s.env ?? environment)(name)
  let hit = cache.get(kept.op)
  if (!hit) return fromOpNow(kept.op, name, s.opNow ?? opReadNow())
  if (hit.until <= Date.now()) void fromOp(kept.op, name, s.op ?? opRead())
  return hit.value
}
