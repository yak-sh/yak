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

import { DatabaseSync } from './sqlite.ts'
import { open } from './db.ts'
import { initVector, loadVector, ownVector } from './vector.ts'

// The clones are isolated :memory: handles: busy_timeout has no peer to wait
// for, and synchronous has no disk to flush. Avoiding those no-op pragmas also
// keeps SQLite from parsing the cloned schema before the test asks for it. The
// snapshot is built lazily and shared, so the DDL cost is paid once per test
// process, not once per db.
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
let bareSnap: Uint8Array | undefined
let prev: DatabaseSync | undefined

// Deserialize a template into a fresh handle, closing the LAST one first (one
// live copy at a time — see the note above). freshDb() and bareDb() share this
// one `prev`, so alternating them across tests still keeps a single live image.
let clone = (bytes: Uint8Array) => {
  if (prev) {
    try {
      prev.close()
    } catch {
      // a test may have closed its own db already — nothing left to free
    }
  }
  let db = new DatabaseSync(':memory:')
  db.deserialize(bytes)
  prev = db
  return db
}

export let freshDb = () => clone(snap ??= open(':memory:').serialize())

// A freshDb clone with the vector extension loaded onto its connection. The
// extension's functions (vector_quantize, vector_quantize_scan) are per-
// CONNECTION and don't ride the serialized image, so a KNN test's clone must
// load them itself — kept OFF the default clone so the many extension-free
// freshDb tests never pay the ~3ms load. KNN tests are slow() anyway: the
// extension's first quantize is a ~10ms cold build.
export let vectorDb = () => {
  let db = freshDb()
  loadVector(db)
  // A test process is the sole writer of its own throwaway graph, so it claims
  // the quantize the same way the embed sweep's process does in production —
  // without the claim refreshVector is inert (T-22622).
  ownVector()
  initVector(db)
  return db
}

// An UNSEEDED migrated clone: same schema as freshDb, but the ~180-row demo
// seed stripped. snapshot() walks only the rows a test writes itself (~0.09ms)
// instead of the whole seed (~1.9ms), so a test that creates its own entities
// and reads them back stays well under the 1ms budget. Use freshDb() only when
// a test actually reads the demo seed (its tasks, boards, or people).
export let bareDb = () => {
  if (!bareSnap) {
    let d = open(':memory:')
    // Strip the seed wholesale — FK off so table order doesn't matter (a parent
    // may be cleared before its child). It's a connection pragma, not stored in
    // the serialized bytes, so clones deserialize with enforcement intact.
    d.exec('pragma foreign_keys = off')
    for (
      let { name } of d.prepare(
        `select name from sqlite_master where type = 'table'
           and name not like 'sqlite_%'
           and name not like '%_fts%'
           and name not like '%_gram%'`,
      ).all() as { name: string }[]
    ) d.exec(`delete from "${name}"`)
    bareSnap = d.serialize()
    d.close()
  }
  return clone(bareSnap)
}
