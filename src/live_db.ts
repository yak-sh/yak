// The ONE live handle — the server process's shared connection, opened at
// import and held for the process lifetime. SERVER-SIDE ONLY: importing this
// module opens and transactionally migrates the graph named by DB_PATH. Library consumers — the CLI's
// local-read arm (localread.ts), tests, anything that only needs db.ts's
// functions — import db.ts, which runs nothing at module scope, and open their
// own handle deliberately. This split is what lets db.ts be library code
// (D-22388): the CLI importing eager()/search() must not migrate as a side
// effect (T-22497).
//
// This is also the ONE place the vector extension is asked for (the `true`
// below). It is write-capable, so under D-22530 it loads only where its write
// lives — the serving/doing distribution, never a library consumer that
// happens to call connect(). Loading it does not claim the WRITE: that is
// ownVector(), taken by whichever process runs the embed sweep (doing.ts).
// The app-plane compatibility process opens read-only. Production refuses that
// mode on the owner graph; disposable parity copies may still exercise it.
import { appPlane } from './db.ts'
import { connect, file, liveDb, open, sameGraphFile } from './store/sqlite.ts'

if (appPlane() && sameGraphFile(file, liveDb())) {
  throw new Error(
    'TASKS_PLANE=app cannot open the owner graph: production runs one serving ' +
      'process per database. Use a disposable DB_PATH for parity tests.',
  )
}

export let db = appPlane() ? connect(file, true, true) : open(file, true)
