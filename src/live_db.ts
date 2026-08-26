// The ONE live handle — the server process's shared connection, opened at
// import and held for the process lifetime. SERVER-SIDE ONLY: importing this
// module OPENS (and, as sole writer, MIGRATES) the graph named by DB_PATH, so
// it belongs to the process that IS the writer. Library consumers — the CLI's
// local-read arm (localread.ts), tests, anything that only needs db.ts's
// functions — import db.ts, which runs nothing at module scope, and open their
// own handle deliberately. This split is what lets db.ts be library code
// (D-22388): the CLI importing eager()/search() must not boot a writer as a
// side effect, which is exactly what happened when this export lived in db.ts
// (T-22497 — every CLI invocation ran open() on the live graph, outside the
// writer baton).
//
// A --join deploy successor must NOT migrate at import: its predecessor still
// holds the graph, and migrating beside it is the two-writer write that
// corrupted the WAL (T-20223). It connects read-capable now and migrates later
// — under the writer baton, once server.ts has bound the port and the
// predecessor has released the DB (becomeWriter in server.ts). Every other
// boot is the sole writer and opens (connect + migrate) inline as before.
//
// This is also the ONE place the vector extension is asked for (the `true`
// below). It is write-capable, so under D-22530 it loads only where its write
// lives — the serving/doing distribution, never a library consumer that
// happens to call connect(). Loading it does not claim the WRITE: that is
// ownVector(), taken by whichever process runs the embed sweep (doing.ts).
import { connect, file, open } from './db.ts'

export let db = Deno.args.includes('--join')
  ? connect(file, true)
  : open(file, true)
