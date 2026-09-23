// Where a graph's secrets are kept: in a `secrets` directory beside its
// database, never in it. One rule rather than an option, so the plugin sealing
// a value and the host reading it back for a config can never disagree about
// where it went. A graph in memory keeps its secrets in memory too, for exactly
// as long.
//
// Keyed by the config object rather than the path, so everything built from
// one config shares one vault — which for a graph in memory is the only way
// the reader and the writer see the same secrets at all.

import { fileVault } from './file.ts'
import { type Local, ramVault } from './vault.ts'

let vaults = new WeakMap<object, Local>()

let dir = (db: string) => {
  let at = db.lastIndexOf('/')
  return `${at < 0 ? '.' : db.slice(0, at) || '/'}/secrets`
}

/** The vault for the graph a config names. */
export let vaultOf = (config: { db?: string }): Local => {
  let held = vaults.get(config)
  if (held) return held
  let db = config.db ?? Deno.env.get('DB_PATH')
  let made = db && db != ':memory:' ? fileVault(dir(db)) : ramVault()
  vaults.set(config, made)
  return made
}
