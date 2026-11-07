// Where a connection's credential is kept on yaks.app: the `VAULT` D1
// database, every value in it encrypted under `VAULT_KEY` (@yaks/d1
// `d1Vault`). The directory seals into it after a write commits and reads
// from it when a call goes out (graph.ts, connections.ts); nothing else holds
// a key.
//
// One vault per binding and key, so every seal and every read in this isolate
// shares its lock queue and the salt it has already read.
//
// Without the database or the key — the workerd probes that set neither, a
// deploy before the secret was put — the vault is shut: writing a key is
// refused before anything commits, and a deleted connection has nothing to
// drop.
import { type D1Vault, d1Vault } from '@yaks/d1'
import type { Vault } from '@yaks/secrets'
import type { Env } from './env.ts'
import { elapsed } from './lib/hops.ts'

let no = (): never => {
  throw new Error('no vault is set up here')
}

let shut: Vault = {
  salt: no,
  read: no,
  seal: no,
  all: no,
  drop: () => {},
  lock: (_, fn) => fn(),
}

// The key, from its base64. A key that is not one fails every use of the
// vault, which is the configuration saying so.
let keyOf = (text: string): Promise<CryptoKey> => {
  let bytes = Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0))
  let key = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
  // Awaited at every use; marked handled so a key nobody has used yet is not
  // an unhandled rejection.
  key.catch(() => {})
  return key
}

// Each wait on the database a `vault_wait` (timing.ts), summed over the
// request that waited.
let timed = (vault: D1Vault): D1Vault => {
  let waiting =
    <A extends unknown[], T>(fn: (...a: A) => Promise<T>) => (...a: A) =>
      elapsed('vault_wait', () => fn(...a))
  return {
    ...vault,
    salt: waiting(vault.salt),
    read: waiting(vault.read),
    seal: waiting(vault.seal),
    drop: waiting(vault.drop),
    all: waiting(vault.all),
  }
}

// Per binding, then per key: the workerd probes share one database between
// kernels that may each be handed a key.
let vaults = new WeakMap<object, Map<string, Vault>>()

/** Whether this deploy can keep a key. */
export let vaulted = (env: Partial<Env>): boolean =>
  !!env.VAULT && !!env.VAULT_KEY

/** The vault over this env's bindings, or the shut one. */
export let vaultOf = (env: Partial<Env>): Vault => {
  let { VAULT: db, VAULT_KEY: key } = env
  if (!db || !key) return shut
  let keyed = vaults.get(db) ?? new Map<string, Vault>()
  vaults.set(db, keyed)
  let held = keyed.get(key) ?? timed(d1Vault(db, keyOf(key)))
  keyed.set(key, held)
  return held
}
