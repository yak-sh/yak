/**
 * @yaks/secrets — secrets that flow through the graph and are kept somewhere
 * else.
 *
 * A secret is an entity wearing `secret{name, value}`. It is written with its
 * value like anything else; the plugin takes the value out in the first phase
 * of the write, puts the secret's handle — a random token it keeps for as long
 * as the secret lives — where it was, and seals the value into a vault as the
 * transaction commits. The graph, its journal, its sync and its backups only
 * ever hold the handle, which is safe to show anyone. Code that calls out is
 * handed the sentinel instead: the handle hashed under the vault's salt, the
 * one string a swap on the way out replaces with the value.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { ramVault, reveal, sealed, secrets, secretsDoc } from '@yaks/secrets'
 *
 * let vocab = loadVocab([secretsDoc])
 * let vault = ramVault()
 * let g = graph({ storage: ram(vocab), vocab, plugins: [secrets(vault)] })
 * await g.apply([sealed('MAIL_TOKEN', 'cf-token')])
 * // g.read('.secret') → value: 'yak_secret_…', the handle
 * // await reveal(vault, 'MAIL_TOKEN') → 'cf-token'
 * ```
 *
 * Trusted code asks for a value by name ({@link reveal}); a config names one
 * as `{"secret": "NAME"}` (@yaks/cli). A value may also be an `op://`
 * reference, read from 1Password each time it is used, and a name nothing was
 * written for falls back to the environment variable of that name.
 *
 * This package says what a vault is ({@link Vault}) and keeps one in memory;
 * a vault that stores somewhere lives with that storage: private files on a
 * box in @yaks/cli, a D1 database in @yaks/d1. The host hands its vault to the
 * plugin (`@yaks/secrets/rules`).
 *
 * @module
 */

export { secretsDoc } from './vocab.ts'
export { secrets } from './plugin.ts'
export { handle, isHandle, PREFIX, SENTINEL, sentinel } from './sentinel.ts'
export {
  type Local,
  queue,
  ramVault,
  type Sealed,
  type Vault,
} from './vault.ts'
export { isOpRef, type OpRead, opRead } from './op.ts'
export {
  peek,
  reveal,
  sealed,
  secretEid,
  sentinelOf,
  type Sources,
  unsealed,
  warm,
} from './reveal.ts'
export { type Records, records } from './records.ts'
