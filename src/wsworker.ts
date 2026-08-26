// One WS connection's worker (D-22388 step 4). The server accepts the socket
// and pumps raw frames here; this worker is an ordinary library client — its
// own READ-ONLY connection to the graph file, its own subserve state, its own
// query evaluation — serving exactly one client on its own thread, so one
// client's expensive query can never stall another's event loop. Writes never
// happen here: a client's batch posts back to the delegator, whose process
// owns the write connection, the baton discipline, and the journal feed; the
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

let post = (m: unknown) =>
  (self as unknown as { postMessage(m: unknown): void }).postMessage(m)

let sub: Subserve | undefined

self.onmessage = (m: MessageEvent<In>) => {
  let d = m.data
  try {
    if ('init' in d) {
      // connect()-style pragmas without connect(): the worker never migrates
      // (schema stays under the writer baton) and never loads the vector
      // extension (write-capable extensions live only in the owning process).
      let db = new DatabaseSync(d.init, { readOnly: true })
      db.exec('pragma busy_timeout = 5000')
      sub = subserve(db, (json) => post({ frame: json }))
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
    console.warn('wsworker:', e)
  }
}
