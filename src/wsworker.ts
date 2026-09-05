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
import { DatabaseSync } from './store/sqlite.ts'
import { registerCodexSource } from './source_codex.ts'
import { registerManagedSource } from './source_managed.ts'
import { registerSessionSource } from './source_session.ts'
import { type Frame, type Subserve, subserve } from './subserve.ts'
import { subqueue } from './subqueue.ts'

type In =
  | { init: string }
  | { raw: string }
  | { cast: unknown[]; cursor: number }
  | { aged: number }
  | { observe: Frame; session: string }
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
// This socket's serving ORDER (subqueue.ts): the control frames of one burst,
// answered cheapest first, so a tally is not stuck behind a board.
let queue: ReturnType<typeof subqueue> | undefined
let sources = false

// Each Worker is its own JS isolate: the source registry installed by
// server.ts belongs only to the delegator's isolate. Install the same adapters
// here before opening a subscription evaluator, otherwise a file-backed graph
// (the only mode which uses workers) silently loses every transcript-backed
// Session at precisely the lazy-partition door meant to serve it.
let registerSources = () => {
  if (sources) return
  registerSessionSource()
  registerCodexSource()
  registerManagedSource()
  sources = true
}

// An error escaping a served frame is the connection or the file, not one bad
// query (subserve catches those itself) — a client served by silence is the
// failure mode this must never repeat (2026-08-26: workers reading a corrupt
// live db logged here while every join died mute). Report dead; the delegator
// closes the socket and the client reconnects inline. Every door into subserve
// runs through here, the queued ones included: a scheduled serve happens on its
// own turn, past the message handler's own stack.
let guard = (run: () => void) => {
  try {
    run()
  } catch (e) {
    console.warn('wsworker:', e)
    post({ dead: e instanceof Error ? e.message : String(e) })
  }
}

self.onmessage = (m: MessageEvent<In>) => {
  let d = m.data
  guard(() => {
    if ('init' in d) {
      registerSources()
      // connect()-style pragmas without connect(): the worker never migrates
      // and never loads the vector
      // extension (write-capable extensions live only in the owning process).
      db = new DatabaseSync(d.init, { readOnly: true })
      db.exec('pragma busy_timeout = 5000')
      sub = subserve(db, (frame) => post({ frame: JSON.stringify(frame) }))
      queue = subqueue(db, (f) => guard(() => sub?.frame(f)))
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
        queue = undefined
        post({ closed: true })
      }
      return
    }
    if (!sub || !queue) return
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
      // Reads go through this socket's queue: it holds a burst of subscribe
      // frames just long enough to answer the cheap ones first, and passes
      // everything else (the join, an unsub) straight to subserve.
      return queue.push(f)
    }
    if ('cast' in d) return sub.cast(d.cast as never, d.cursor)
    if ('aged' in d) return sub.aged(d.aged)
    if ('observe' in d) return void sub.observe(d.observe, d.session)
  })
}
