// The stand-in (not part of the published package — see deno.json): a Durable
// Object's storage surface over an in-memory SQLite that takes text
// (../sqlite/testing.ts `textual`), so the adapter can be tested without
// Cloudflare. The surface is small enough to imitate exactly — one
// `exec`, one `transactionSync` — and imitating it exactly is the point:
//
//   it takes only SqlStorageValues     a boolean, a bigint or a byte array
//                                      that reached the engine unconverted
//                                      throws here, as it would in workerd
//   it refuses transactions as SQL     `begin`/`savepoint`/`release` are
//                                      errors; `transactionSync` is the only
//                                      transaction, and it nests
//   it refuses Cloudflare's own tables  a statement naming `_cf_KV` throws
//                                      SQLITE_AUTH, the way workerd's
//                                      authorizer does — see {@link prohibited}
//   a blob comes back as an ArrayBuffer
//
// so a bug this stand-in cannot see is a bug the runtime would not have shown
// either.

import {
  col,
  lit,
  not,
  op,
  type Param,
  render,
  select,
  type Stmt,
  table,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { shop, textual } from '../sqlite/testing.ts'
import { type DurableStorage, prohibited, type SqlValue } from './sql.ts'
import { storage, type Store } from './store.ts'

export { shop }

// The statements workerd's authorizer refuses: the runtime owns transactions,
// and attaching or vacuuming another database is not on offer.
let REFUSED =
  /^\s*(begin|commit|end|rollback|savepoint|release|attach|detach|vacuum)\b/i

// workerd's SQL authorizer, at the one place it bites an object that reads its
// own schema: a statement that names a table Cloudflare owns is refused — read,
// write or drop alike — while `sqlite_master` still lists it. There is no
// authorizer callback to hang off the engine, so the identifiers a statement
// mentions are what is checked; the runtime names the column too, which nothing
// here can know. Every statement passes through here, so text that cannot
// hold such a name, one without `cf_` in it, is not split into words at all.
let WORD = /[A-Za-z_][A-Za-z0-9_$]*/g
let refused = (query: string): string | undefined =>
  /cf_/i.test(query)
    ? query.replaceAll('"', ' ').match(WORD)?.find(prohibited)
    : undefined

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

/**
 * A stand-in for `ctx.storage` over a fresh in-memory database.
 *
 * Members beyond {@link DurableStorage}: two because the runtime has
 * them and an object may ask: `databaseSize`, how many bytes it holds, and
 * `deleteAll`, the one way to empty it — dropping the tables leaves metadata
 * behind, and an object whose storage is empty ceases to exist. The object's
 * one alarm is here for the same reason: an object that schedules its own
 * return arms it, and a test that drives `alarm()` by hand reads the instant
 * back off `getAlarm` rather than waiting for a runtime to deliver it.
 * `beneath` is the runtime's own hand rather than the object's.
 * `Symbol.dispose` lets the fixture owner release native allocations without
 * waiting for JS GC.
 */
export let durable = (): DurableStorage & {
  sql: { databaseSize: number }
  deleteAll(): Promise<void>
  getAlarm(): Promise<number | null>
  setAlarm(at: number): Promise<void>
  deleteAlarm(): Promise<void>
  beneath(statement: Stmt): Record<string, unknown>[]
  [Symbol.dispose](): void
} => {
  // The one alarm, as the runtime holds it: an instant or nothing, cleared by
  // the delivery that fires it.
  let alarm: number | null = null
  let db = textual()
  let closed = false
  let depth = 0
  // The runtime takes an ArrayBuffer; the engine underneath takes bytes.
  let run = (query: string, bindings: (SqlValue | Param)[]) => {
    if (closed) throw new Error('storage is disposed')
    return db.run(
      query,
      bindings.map((b) => b instanceof ArrayBuffer ? new Uint8Array(b) : b),
    )
  }
  // What the stand-in says itself, as the runtime does below the authorizer.
  let said = (s: Stmt) => {
    let { sql, params } = render(s)
    return run(sql, params)
  }
  return {
    // Native SQLite allocations are invisible to the JS heap's GC pressure.
    // A scenario that owns this storage can release it at the end of the test.
    [Symbol.dispose]: () => {
      if (!closed) db.close()
      closed = true
    },
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
        let no = refused(query)
        if (no) throw new Error(`access to ${no} is prohibited: SQLITE_AUTH`)
        let rows = run(query, bindings).map(out)
        return { toArray: () => rows, [Symbol.iterator]: () => rows.values() }
      },
      // What this database weighs, the way SQLite itself measures it.
      get databaseSize() {
        let [page] = said({ t: 'pragma', name: 'page_count' })
        let [size] = said({ t: 'pragma', name: 'page_size' })
        return Number(Object.values(page ?? {})[0] ?? 0) *
          Number(Object.values(size ?? {})[0] ?? 0)
      },
    },
    // Empty, all of it — tables, indexes and the virtual tables a full-text
    // index is made of. The runtime throws the whole object's storage away;
    // this drops everything in the schema, which over one in-memory database
    // is the same end state.
    deleteAll: () => {
      let names = said(select({
        cols: [col('type'), col('name')],
        from: table('sqlite_master'),
        where: not(op('like', col('name'), lit('sqlite_%'))),
      }))
      for (let kind of ['trigger', 'view', 'index', 'table'] as const) {
        for (let it of names.filter((n) => n.type == kind)) {
          try {
            said({ t: 'drop', kind, name: String(it.name), ifExists: true })
          } catch { /* a shadow table its virtual table already took */ }
        }
      }
      return Promise.resolve()
    },
    getAlarm: () => Promise.resolve(alarm),
    setAlarm: (at: number) => Promise.resolve(void (alarm = at)),
    deleteAlarm: () => Promise.resolve(void (alarm = null)),
    // A statement run below the authorizer, as the runtime itself does:
    // creating `_cf_KV` and reading it back are both things workerd refuses to
    // an object and does itself. This is the only way a test can see what every
    // deployed object actually contains.
    beneath: said,
    // Nested savepoints, which is what the runtime's own transaction is: an
    // inner throw rolls back only the inner run.
    transactionSync: (body) => {
      let name = `do_tx_${depth++}`
      said({ t: 'savepoint', name })
      try {
        let value = body()
        said({ t: 'release', name })
        return value
      } catch (e) {
        said({ t: 'rollback', to: name })
        said({ t: 'release', name })
        throw e
      } finally {
        depth--
      }
    },
  }
}

/** A ready store over that stand-in, schema installed. The shop numbers: its
 * entities are things a person points at by number. */
export let store = (vocab: Vocab = shop): Store => {
  let s = storage(durable(), vocab, { number: true })
  s.install()
  return s
}
