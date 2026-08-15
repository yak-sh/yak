// A migrated in-memory db for tests, cloned from a snapshot instead of replayed.
// open() runs ~200 DDL statements (schema + migrations + seed + FTS + integrity)
// — ~40ms every call, and a db-heavy test file does dozens of opens. serialize()
// captures that migrated file once; deserialize() is a page memcpy (~0.07ms,
// ~500x faster), a clone with the whole schema and full write-isolation from the
// template. Use freshDb() for any test that just needs a working graph; a test
// that exercises open()/migrations/seed itself keeps calling open() directly,
// since replaying the DDL is the thing it checks.
//
// This lives apart from testing.ts on purpose: it imports db.ts, whose
// module-init opens the graph, so it carries the same DB_PATH import-order
// discipline — set DB_PATH before importing it. testing.ts (slow/tick/until)
// stays db-free so the ~40 files that want only those primitives never trip it.

import { DatabaseSync } from 'node:sqlite'
import { open } from './db.ts'

// Connection pragmas live on the handle, not in the serialized bytes, so
// re-apply the two open() sets after deserialize: busy_timeout, and synchronous
// when TASKS_SYNC is set. open() registers no custom SQL functions or
// collations, so nothing else needs re-applying. The snapshot is built lazily
// and shared, so the DDL cost is paid once per test process, not once per db.
//
// Each deserialized handle owns a private copy of the ~1.1MB migrated image,
// and a db-heavy file calls freshDb() dozens of times. Handing out a handle
// and never closing it left those copies live for the whole process: 2000
// unclosed handles measured ~525µs/deserialize and climbing (allocation +
// GC pressure), the accumulation tail that pushed db tests to 0.5–1.5ms. So
// freshDb() closes the handle it minted LAST before minting the next — one
// live copy at a time, a flat ~70µs/call with no tail. Tests use one db each
// and run sequentially within a process, so the prior test's handle is always
// spent by the next call; a test that needs two live dbs at once must open its
// own via open(). (Savepoint rollback would reset in ~0.5µs, but apply() owns
// the top-level transaction with `begin immediate` and can't nest inside an
// open savepoint — so a fresh deserialized handle, not a shared reset one, is
// what stays compatible with every writer.)
let snap: Uint8Array | undefined
let prev: DatabaseSync | undefined
export let freshDb = () => {
  if (!snap) snap = open(':memory:').serialize()
  if (prev) {
    try {
      prev.close()
    } catch {
      // a test may have closed its own db already — nothing left to free
    }
  }
  let db = new DatabaseSync(':memory:')
  db.deserialize(snap)
  db.exec('pragma busy_timeout = 5000')
  let sync = Deno.env.get('TASKS_SYNC')
  if (sync) db.exec(`pragma synchronous = ${sync}`)
  prev = db
  return db
}
