// Journal catchup — the graph's one change feed, read since a cursor
// (D-22388 step 1). A consumer holds a rowid cursor into the journal and is
// handed each row past it in rowid order: the caller's own commits and a
// foreign process's uniformly, because the JOURNAL is the record of what
// committed, not any process's in-memory return value. This module depends on
// nothing in server.ts — the singleton server is just its first caller, and a
// per-connection worker (D-22388 step 4) reuses it unmodified.
//
// Exactly-once per row, by construction: the cursor is monotonic, only
// settle() advances it, and a row is handed to onRow in precisely the pass
// that steps the cursor over it. `running` serializes re-entrant calls — an
// onRow handler that WRITES (an effect applying a stamp) re-enters settle(),
// which marks `dirty` and returns; the outer drain loops again and picks the
// new row up. So no two passes can hold the same row, and an effect can never
// fire twice for one journal row. What a crash between commit and dispatch
// loses is the row's effects — at-most-once, the same contract effects.ts
// documents, healed by the boot sweeps (relay()); broadcast loss heals itself
// because every client reconnects through the same journal.
import type { DatabaseSync } from './sqlite.ts'
import { cursorOf, type JournalRow, journalSince } from './db.ts'

// PRAGMA data_version: bumped when ANOTHER connection commits, never by our
// own. Poll it instead of watching the database directory. On POSIX, closing
// any descriptor for a file drops that process's advisory locks on the file;
// Deno.watchFs may transiently open/close a changed path while translating an
// event. Doing that beside SQLite silently drops the connection's locks and
// lets another process treat an idle connection as absent during WAL cleanup.
// SQLite polling stays entirely inside the VFS that owns those locks.
let version = (db: DatabaseSync): number =>
  Number(
    (db.prepare('pragma data_version').get() as { data_version: number })
      .data_version,
  )

export let catchup = (db: DatabaseSync, onRow: (r: JournalRow) => void) => {
  // Boot starts AT the top: history is never replayed — a restart must not
  // re-fire yesterday's effects; the boot reconciliation sweeps own that gap.
  let cursor = cursorOf(db)
  let seen = version(db)
  let running = false
  let dirty = false
  let settle = () => {
    if (running) {
      dirty = true
      return
    }
    running = true
    try {
      do {
        dirty = false
        // Version BEFORE the drain: a foreign commit landing between the two
        // is either drained now (and its bump re-checked as a no-op pass) or
        // bumps past `seen` and wakes the next pass — never silently skipped.
        seen = version(db)
        for (let r of journalSince(db, cursor)) {
          cursor = r.rowid
          // A failing consumer must not wedge the feed: the row is spent
          // (cursor already past it), the failure is the consumer's telemetry.
          try {
            onRow(r)
          } catch (e) {
            console.warn(`catchup: row ${r.rowid} consumer failed —`, e)
          }
        }
      } while (dirty)
    } finally {
      running = false
    }
  }
  // Foreign writers cannot call settle() in this process, so poll the
  // connection-local data_version. Own writes still settle inline and do not
  // bump this value. One cheap pragma every 25ms keeps the live stream prompt
  // without touching the database path outside SQLite.
  let timer: ReturnType<typeof setInterval> | undefined
  let watch = (file: string) => {
    if (file == ':memory:') return
    timer ??= setInterval(() => {
      if (version(db) != seen) settle()
    }, 25)
  }
  // A probe or test must be able to put the feed down without leaking a timer.
  let stop = () => {
    clearInterval(timer)
    timer = undefined
  }
  return { settle, watch, stop, at: () => cursor }
}
