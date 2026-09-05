// The stand-in (not part of the published package — see deno.json): a Durable
// Object's storage surface over jsr:@db/sqlite, so the adapter can be tested
// without Cloudflare. The surface is small enough to imitate exactly — one
// `exec`, one `transactionSync` — and imitating it EXACTLY is the point:
//
//   it takes only SqlStorageValues     a boolean, a bigint or a byte array
//                                      that reached the engine unconverted
//                                      throws here, as it would in workerd
//   it refuses transactions as SQL     `begin`/`savepoint`/`release` are
//                                      errors; `transactionSync` is the only
//                                      transaction, and it nests
//   a blob comes back as an ArrayBuffer
//
// so a bug this stand-in cannot see is a bug the runtime would not have shown
// either.

import { Database } from '@db/sqlite'
import type { Vocab } from '@yaks/vocab'
import { shop } from '../sqlite/harness.ts'
import type { DurableStorage, SqlValue } from './sql.ts'
import { storage, type Store } from './store.ts'

export { shop }

// The statements workerd's authorizer refuses: the runtime owns transactions,
// and attaching or vacuuming another database is not on offer.
let REFUSED =
  /^\s*(begin|commit|end|rollback|savepoint|release|attach|detach|vacuum)\b/i

let ok = (value: unknown): value is SqlValue =>
  value === null || typeof value == 'string' || typeof value == 'number' ||
  value instanceof ArrayBuffer

// Bytes out as an ArrayBuffer, the way the runtime hands back a blob.
let out = (row: Record<string, unknown>) => {
  for (let key in row) {
    let value = row[key]
    if (value instanceof Uint8Array) {
      row[key] = value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      )
    }
  }
  return row
}

/** A stand-in for `ctx.storage` over a fresh in-memory database. */
export let durable = (): DurableStorage => {
  let db = new Database(':memory:')
  let depth = 0
  let run = (query: string, bindings: SqlValue[]) => {
    // The runtime takes an ArrayBuffer; the library underneath takes bytes.
    let binds = bindings.map((b) =>
      b instanceof ArrayBuffer ? new Uint8Array(b) : b
    )
    try {
      return db.prepare(query).all(...binds) as Record<string, unknown>[]
    } catch (e) {
      // A statement SQLite will not prepare (a whole DDL script) still runs;
      // it just has no rows. With bindings there is nothing to fall back to.
      if (bindings.length) throw e
      db.exec(query)
      return []
    }
  }
  return {
    sql: {
      exec: (query, ...bindings) => {
        for (let b of bindings) {
          if (!ok(b)) {
            throw new TypeError(`cannot bind ${typeof b}: ${String(b)}`)
          }
        }
        if (REFUSED.test(query)) {
          throw new Error(
            `not authorized: use transactionSync, not \`${query.trim()}\``,
          )
        }
        let rows = run(query, bindings).map(out)
        return { toArray: () => rows, [Symbol.iterator]: () => rows.values() }
      },
    },
    // Nested savepoints, which is what the runtime's own transaction is: an
    // inner throw rolls back only the inner run.
    transactionSync: (body) => {
      let name = `do_tx_${depth++}`
      db.exec(`savepoint ${name}`)
      try {
        let value = body()
        db.exec(`release ${name}`)
        return value
      } catch (e) {
        db.exec(`rollback to ${name}`)
        db.exec(`release ${name}`)
        throw e
      } finally {
        depth--
      }
    },
  }
}

/** A ready store over that stand-in, schema installed. */
export let store = (vocab: Vocab = shop): Store => {
  let s = storage(durable(), vocab)
  s.install()
  return s
}
