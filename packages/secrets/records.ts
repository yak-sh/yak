// A private record kept as a secret: JSON under a name, read by trusted code
// and changed only while it is held. It is what an OAuth client keeps between
// runs — the tokens, and the refresh that replaces them — and it has the shape
// @yaks/oauth's `AuthorizationStore` asks for, so @yaks/connections keeps each
// connection's grant here rather than in files of its own.
//
// A change is a write through the graph like any other, so the record's name
// and sentinel are in the graph and its contents are in the vault. The read,
// the change and the write back happen while the vault holds the secret
// against every other writer: two processes refreshing one token at once would
// otherwise each spend the refresh token the other one needs.

import type { Bundle } from '@yaks/graph'
import { reveal, sealed, secretEid } from './reveal.ts'
import type { Vault } from './vault.ts'

/** Private records by key, each the secret `<prefix><key>`. */
export type Records<R extends object> = {
  read: (key: string) => Promise<R | undefined>
  /** `fn` changes the record in place; a change is written back. */
  update: <T>(key: string, fn: (record: R) => Promise<T>) => Promise<T>
}

/** Records kept as secrets in this graph. `check` refuses a record that is not
 * the shape its reader expects. */
export let records = <R extends object>(
  g: { apply: (bundles: Bundle[]) => unknown },
  vault: Vault,
  prefix: string,
  check: (record: R) => void = () => {},
): Records<R> => {
  let named = (key: string) => prefix + key
  let read = async (key: string): Promise<R | undefined> => {
    let text = await reveal(vault, named(key), { env: () => undefined })
    if (!text) return undefined
    let record = JSON.parse(text)
    if (!record || typeof record != 'object' || Array.isArray(record)) {
      throw new Error(`${named(key)} is not a record`)
    }
    check(record)
    return record
  }
  return {
    read,
    update: (key, fn) =>
      vault.lock(secretEid(named(key)), async () => {
        let record: R = await read(key) ?? Object.create(null)
        let was = JSON.stringify(record)
        try {
          return await fn(record)
        } finally {
          let now = JSON.stringify(record)
          if (now != was) await g.apply([sealed(named(key), now)])
        }
      }),
  }
}
