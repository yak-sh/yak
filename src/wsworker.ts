// One WS connection's worker (D-22388 step 4). The server accepts the socket
// and pumps raw frames here; this worker is an ordinary library client — its
// own READ-ONLY connection to the graph file, its own subserve state, its own
// query evaluation — serving exactly one client on its own thread, so one
// client's expensive query can never stall another's event loop. Writes never
// happen here: a client's batch posts back to the delegator, whose process
// owns the server connection and journal feed; the
// commit returns as a {cast} message like every other commit. A Deno Worker
// (not a subprocess) because workers are real threads with their own isolate —
// full CPU isolation for eval and stringify — while sharing the module cache
// and costing no per-tab process spawn; permissions inherit from the server
// (-A), and the read-only open means a bug here cannot write the graph.
/// <reference lib="webworker" />
import { DatabaseSync } from './sqlite.ts'
import { type Subserve, subserve } from './subserve.ts'

type In =
  | { init: string }
  | { raw: string }
  | { cast: unknown[]; cursor: number }
  | { aged: number }
  | { observe: string; session: string }
  | { close: true }

let post = (m: unknown) =>
  (self as unknown as { postMessage(m: unknown): void }).postMessage(m)

// The worker OWNS its read-only connection, so it must be the one to close it.
// Worker.terminate() kills this isolate without ever closing an FFI-opened
// sqlite3 handle — the fd is not a resource Deno tracks — so the read fd (and
// the WAL read mark it pins) would leak, one pair per socket ever served
// (T-22658). Held at module scope so the {close} teardown can reach it.
let db: DatabaseSync | undefined
let sub: Subserve | undefined

self.onmessage = (m: MessageEvent<In>) => {
  let d = m.data
  try {
    if ('init' in d) {
      // connect()-style pragmas without connect(): the worker never migrates
      // and never loads the vector
      // extension (write-capable extensions live only in the owning process).
      db = new DatabaseSync(d.init, { readOnly: true })
      db.exec('pragma busy_timeout = 5000')
      sub = subserve(db, (json) => post({ frame: json }))
      return
    }
    if ('close' in d) {
      // The delegator is tearing this socket down. Close the connection here and
      // answer {closed} so the delegator terminates only AFTER — never relying on
      // terminate() to reclaim it, which it can't (the FFI sqlite3* is a
      // process-global native handle, not a resource the isolate owns). An
      // un-closed handle leaks unbounded: measured +2 fds per socket, forever.
      // Closed, SQLite's unix VFS stashes the fd on the inode's unused list —
      // it can't close() it outright while the writer in this same process still
      // holds POSIX locks on the inode (a close would drop them all) — and the
      // NEXT worker's open reuses it, so the open-fd count is bounded by peak
      // concurrency instead of growing per socket.
      try {
        db?.close()
      } finally {
        db = undefined
        sub = undefined
        post({ closed: true })
      }
      return
    }
    if (!sub) return
    if ('raw' in d) {
      let f = JSON.parse(d.raw)
      // Write batches route back to the writer process; the ack/error frames
      // come from there, straight onto the socket.
      if (Array.isArray(f)) return post({ apply: f })
      if (Array.isArray(f.apply)) {
        return post({
          apply: f.apply,
          id: f.id != null ? String(f.id) : undefined,
        })
      }
      return sub.frame(f)
    }
    if ('cast' in d) return sub.cast(d.cast as never, d.cursor)
    if ('aged' in d) return sub.aged(d.aged)
    if ('observe' in d) return void sub.observe(d.observe, d.session)
  } catch (e) {
    // An error escaping to here is the connection or the file, not one bad
    // query (subserve catches those itself) — a client served by silence is
    // the failure mode this must never repeat (2026-08-26: workers reading a
    // corrupt live db logged here while every join died mute). Report dead;
    // the delegator closes the socket and the client reconnects inline.
    console.warn('wsworker:', e)
    post({ dead: e instanceof Error ? e.message : String(e) })
  }
}
