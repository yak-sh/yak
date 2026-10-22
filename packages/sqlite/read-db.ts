// The file reader binds only SQLite's connection, statement and value API.
// It shares the Driver boundary with the writer, without loading callbacks,
// database images or the writer's native wrapper. Extensions can read existing
// indexes; SQLite's read-only handle refuses any metadata they try to write.
import { sqlitePath } from './sqlitepath.ts'
import type { Opened } from './db.ts'
import type { Param, Row } from '@yaks/sql'
import { driver } from './driver.ts'
import { meter } from './budget.ts'

let bind = () =>
  Deno.dlopen(
    sqlitePath,
    {
      sqlite3_open_v2: {
        parameters: ['buffer', 'buffer', 'i32', 'pointer'],
        result: 'i32',
      },
      sqlite3_close: { parameters: ['pointer'], result: 'i32' },
      sqlite3_db_config: {
        parameters: ['pointer', 'i32', 'i32', 'pointer'],
        result: 'i32',
      },
      sqlite3_busy_timeout: { parameters: ['pointer', 'i32'], result: 'i32' },
      sqlite3_load_extension: {
        parameters: ['pointer', 'buffer', 'pointer', 'pointer'],
        result: 'i32',
      },
      sqlite3_errmsg: { parameters: ['pointer'], result: 'pointer' },
      sqlite3_prepare_v2: {
        parameters: ['pointer', 'buffer', 'i32', 'buffer', 'buffer'],
        result: 'i32',
      },
      sqlite3_stmt_readonly: { parameters: ['pointer'], result: 'i32' },
      sqlite3_stmt_status: {
        parameters: ['pointer', 'i32', 'i32'],
        result: 'i32',
      },
      sqlite3_bind_parameter_count: { parameters: ['pointer'], result: 'i32' },
      sqlite3_bind_null: { parameters: ['pointer', 'i32'], result: 'i32' },
      sqlite3_bind_int64: {
        parameters: ['pointer', 'i32', 'i64'],
        result: 'i32',
      },
      sqlite3_bind_double: {
        parameters: ['pointer', 'i32', 'f64'],
        result: 'i32',
      },
      sqlite3_bind_text: {
        parameters: ['pointer', 'i32', 'buffer', 'i32', 'pointer'],
        result: 'i32',
      },
      sqlite3_bind_blob: {
        parameters: ['pointer', 'i32', 'buffer', 'i32', 'pointer'],
        result: 'i32',
      },
      sqlite3_step: { parameters: ['pointer'], result: 'i32' },
      sqlite3_reset: { parameters: ['pointer'], result: 'i32' },
      sqlite3_clear_bindings: { parameters: ['pointer'], result: 'i32' },
      sqlite3_finalize: { parameters: ['pointer'], result: 'i32' },
      sqlite3_column_count: { parameters: ['pointer'], result: 'i32' },
      sqlite3_column_name: {
        parameters: ['pointer', 'i32'],
        result: 'pointer',
      },
      sqlite3_column_type: { parameters: ['pointer', 'i32'], result: 'i32' },
      sqlite3_column_int64: { parameters: ['pointer', 'i32'], result: 'i64' },
      sqlite3_column_double: { parameters: ['pointer', 'i32'], result: 'f64' },
      sqlite3_column_text: {
        parameters: ['pointer', 'i32'],
        result: 'pointer',
      },
      sqlite3_column_blob: {
        parameters: ['pointer', 'i32'],
        result: 'pointer',
      },
      sqlite3_column_bytes: { parameters: ['pointer', 'i32'], result: 'i32' },
    } as const,
  )

let api: ReturnType<typeof bind> | undefined
let encoder = new TextEncoder(), decoder = new TextDecoder()
let cstring = (s: string) => encoder.encode(s + '\0')
let pointer = (p: BigUint64Array) =>
  p[0] ? Deno.UnsafePointer.create(p[0]) : null
let text = (p: Deno.PointerValue) =>
  p ? new Deno.UnsafePointerView(p).getCString() : ''
// SQLITE_TRANSIENT makes SQLite own copies of bound strings and blobs.
let transient = Deno.UnsafePointer.create(0xffffffffffffffffn)
let empty = new Uint8Array(1)

/** Open an existing SQLite file for reading, without changing journal
 * settings or attempting a checkpoint when its last reader closes. Queries
 * use the same SQL AST, snapshots and tracing as the writable driver, and every
 * row decoded counts against the read running (./budget.ts). */
export let open = (path: string): Opened => {
  let c = (api ??= bind()).symbols
  let handle = new BigUint64Array(1)
  let rc = c.sqlite3_open_v2(cstring(path), handle, 1, null) // SQLITE_OPEN_READONLY
  let db = pointer(handle)
  let error = () =>
    new Error(db ? text(c.sqlite3_errmsg(db)) : `SQLite error ${rc}`)
  if (rc) {
    let failure = error()
    if (db) c.sqlite3_close(db)
    throw failure
  }
  let check = (code: number) => {
    if (code) throw error()
  }
  let cache = new Map<string, {
    stmt: Deno.PointerValue
    count: number
    names?: string[]
  }>()
  let closed = false
  let checkOpen = () => {
    if (closed) throw new Error('the database is closed')
  }
  let close = () => {
    if (closed) return
    for (let { stmt } of cache.values()) c.sqlite3_finalize(stmt)
    cache.clear()
    check(c.sqlite3_close(db))
    closed = true
  }
  try {
    check(c.sqlite3_db_config(db, 1006, 1, null)) // NO_CKPT_ON_CLOSE
    check(c.sqlite3_db_config(db, 1002, 1, null)) // ENABLE_FKEY
    check(c.sqlite3_busy_timeout(db, path == ':memory:' ? 0 : 60_000))
    let prepare = (sql: string) => {
      let bytes = cstring(sql),
        out = new BigUint64Array(1),
        tail = new BigUint64Array(1)
      check(c.sqlite3_prepare_v2(db, bytes, bytes.length, out, tail))
      let stmt = pointer(out)
      if (!stmt) throw new Error('SQLite expected a statement')
      if (text(pointer(tail)).trim() || !c.sqlite3_stmt_readonly(stmt)) {
        c.sqlite3_finalize(stmt)
        throw new Error(
          'the read-only database requires one read-only statement',
        )
      }
      return { stmt, count: c.sqlite3_bind_parameter_count(stmt) }
    }
    let bind = (stmt: Deno.PointerValue, i: number, value: Param) => {
      if (value == null) return c.sqlite3_bind_null(stmt, i)
      if (
        typeof value == 'boolean' || typeof value == 'bigint' ||
        typeof value == 'number' && Number.isSafeInteger(value)
      ) {
        return c.sqlite3_bind_int64(stmt, i, BigInt(value))
      }
      if (typeof value == 'number') return c.sqlite3_bind_double(stmt, i, value)
      if (typeof value == 'string') {
        let bytes = encoder.encode(value)
        return c.sqlite3_bind_text(
          stmt,
          i,
          bytes.length ? bytes : empty,
          bytes.length,
          transient,
        )
      }
      return c.sqlite3_bind_blob(
        stmt,
        i,
        value.length ? value : empty,
        value.length,
        transient,
      )
    }
    let column = (stmt: Deno.PointerValue, i: number): unknown => {
      let type = c.sqlite3_column_type(stmt, i)
      switch (type) {
        case 1: {
          let value = c.sqlite3_column_int64(stmt, i), number = Number(value)
          return Number.isSafeInteger(number) ? number : BigInt(value)
        }
        case 2:
          return c.sqlite3_column_double(stmt, i)
        case 3:
        case 4: {
          let string = type == 3
          let p = string
            ? c.sqlite3_column_text(stmt, i)
            : c.sqlite3_column_blob(stmt, i)
          let n = c.sqlite3_column_bytes(stmt, i)
          if (!n || !p) return string ? '' : new Uint8Array()
          let bytes = new Uint8Array(
            new Deno.UnsafePointerView(p).getArrayBuffer(n),
          )
          // Decoding consumes the current row synchronously; blobs need a
          // copy that survives the next step or the connection closing.
          return string ? decoder.decode(bytes) : bytes.slice()
        }
        default:
          return null
      }
    }
    let run = (sql: string, params: Param[]): Row[] => {
      let held = cache.get(sql)
      if (held) cache.delete(sql)
      else {
        held = prepare(sql)
        if (cache.size >= 256) {
          let oldest = cache.keys().next().value!
          c.sqlite3_finalize(cache.get(oldest)!.stmt)
          cache.delete(oldest)
        }
      }
      cache.set(sql, held)
      let { stmt, count } = held
      try {
        if (params.length != count) {
          throw new Error('parameters must match the statement')
        }
        params.forEach((value, i) => check(bind(stmt!, i + 1, value)))
        let rows: Row[] = [], names: string[] | undefined, code: number
        while ((code = c.sqlite3_step(stmt)) == 100) { // SQLITE_ROW
          if (!names) {
            // The first step may have recompiled the kept statement. Its
            // column names stay valid until SQLite does so again.
            let changed = c.sqlite3_stmt_status(stmt, 5, 1) // REPREPARE
            if (!held.names || changed) {
              held.names = Array.from(
                { length: c.sqlite3_column_count(stmt) },
                (_, i) => text(c.sqlite3_column_name(stmt!, i)),
              )
            }
            names = held.names
          }
          let row = Object.fromEntries(
            names.map((name, i) => [name, column(stmt!, i)]),
          )
          meter(row)
          rows.push(row)
        }
        if (code != 101) throw error() // SQLITE_DONE
        check(c.sqlite3_reset(stmt))
        check(c.sqlite3_clear_bindings(stmt))
        return rows
      } catch (error) {
        cache.delete(sql)
        c.sqlite3_finalize(stmt)
        throw error
      }
    }
    return Object.assign(
      driver(run, {
        file: path != ':memory:' && path != '',
        before: checkOpen,
      }),
      {
        extension: (file: string) => {
          checkOpen()
          // Enable only the C loading API, never SQL's load_extension().
          check(c.sqlite3_db_config(db, 1005, 1, null)) // ENABLE_LOAD_EXTENSION
          try {
            check(c.sqlite3_load_extension(db, cstring(file), null, null))
          } finally {
            check(c.sqlite3_db_config(db, 1005, 0, null))
          }
        },
        close,
      },
    )
  } catch (error) {
    close()
    throw error
  }
}
