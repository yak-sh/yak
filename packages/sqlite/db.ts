// The embedded driver itself — @db/sqlite, opened against a library that
// works. This module is its one door, and it hands out none of it: a caller
// gets `open(path)`, a {@link Driver} over the database there (./native.ts),
// and never the driver's own objects. So ./sqlitepath.ts has always named the
// system library by the time the FFI initializes (importing @db/sqlite first
// segfaults on Linux with nothing on stderr; ./sqlitepath_test.ts), and a
// different driver is a change to this package alone.
//
// ./mod.ts stays free of it on purpose: the adapter there works against any
// `Driver`, and only an application that wants an in-process database needs
// this.

import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import type { Driver } from '@yaks/sql'
import { driver } from './native.ts'

/** A database this process opened: its {@link Driver}, and the way to close
 * it. */
export type Opened = Driver & { close: () => void }

/**
 * Open (or create) the database at `path` — a file, whose directory is made
 * when missing, or `:memory:` — as a {@link Driver} to bind `storage()` to.
 * This is the one place a connection's settings are made.
 *
 * Every connection runs with foreign keys on. A file is one other processes
 * may have open too, so it also runs in WAL mode, with WAL's crash-safe pairing
 * `synchronous = normal` and a five-second busy timeout; a database in memory
 * belongs to this process alone and needs none of that.
 *
 * ```ts
 * import { open } from '@yaks/sqlite/db'
 *
 * let sql = open(':memory:')
 * sql.query({ t: 'create table', name: 't', cols: [{ name: 'x' }] })
 * sql.close()
 * ```
 */
export let open = (path: string): Opened => {
  if (path != ':memory:') {
    let dir = path.slice(0, path.lastIndexOf('/'))
    if (dir) Deno.mkdirSync(dir, { recursive: true })
  }
  let db = new Database(path)
  let d = driver(db)
  let set = (name: string, value: string | number) =>
    d.query({ t: 'pragma', name, value })
  set('foreign_keys', 'on')
  if (path != ':memory:') {
    set('journal_mode', 'wal')
    set('synchronous', 'normal')
    set('busy_timeout', 5000)
  }
  return { ...d, close: () => db.close() }
}
