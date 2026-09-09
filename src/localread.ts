// The CLI's local graph arm: reads and mutations use the server's SQLite
// kernels when the caller names a graph file on this machine. Mutations carry
// a fed trace so the server and effects daemon observe the committed journal;
// this process never executes effects or migrates the database.
//
// An explicit DB_PATH selects that file, while an explicit remote TASKS_HOST
// without DB_PATH keeps every operation on HTTP. The default host pairs with
// the owner graph. :memory: and TASKS_LOCAL=0 disable local access.
//
// Reads retain their wire fallback on schema skew. A local write validates the
// schema before mutation and surfaces any error directly: retrying a write over
// HTTP could repeat a commit whose response failed after the transaction.
import { DatabaseSync, liveDb, sameGraphFile } from './store/sqlite.ts'
import {
  depsOf,
  eager,
  journalBy,
  journalOf,
  mutate,
  scanAnomalies,
  schemaVersion,
} from './db.ts'
import { fed } from './effects.ts'
import { localQuery } from './graph_query.ts'
import { catalog } from './catalog.ts'
import {
  arm,
  DEFAULT_HOST,
  type DepsFn,
  httpDeps,
  httpHistory,
  httpHistoryBy,
  httpIntegrity,
  httpQuery,
  httpTelemetry,
  httpTelemetryStats,
  httpWork,
} from './client.ts'
import { recent, stats } from './telemetry.ts'
import { workCandidates, type WorkLane } from './work.ts'

// Where the arm may read, or undefined for wire-only. Pure over its inputs —
// no env defaults, so the decision table tests without an environment — and
// envPath is the one reader of the process's own naming.
export let armPath = (env: {
  dbPath?: string
  host?: string
  disabled?: boolean
  live: string
}): string | undefined =>
  env.disabled || env.dbPath == ':memory:' ? undefined : env.dbPath ??
    (env.host && env.host != DEFAULT_HOST ? undefined : env.live)

let envPath = () =>
  armPath({
    dbPath: Deno.env.get('DB_PATH'),
    host: Deno.env.get('TASKS_HOST'),
    disabled: Deno.env.get('TASKS_LOCAL') == '0',
    live: liveDb(),
  })

// Operator libraries use the same locality decision as the read arm. They may
// open this path read-only, but an explicit remote host has no local graph to
// inspect and must fail rather than silently reading the owner's default db.
export let localReadPath = envPath

// Local answers; on a local failure the wire answers instead and the arm
// disarms (skew is permanent for this process); when the wire fails too the
// LOCAL error surfaces. Exported for its seam test only.
export let guarded = <A extends unknown[], R>(
  local: (...a: A) => R | Promise<R>,
  wire: (...a: A) => Promise<R>,
  off = disarm,
) =>
async (...a: A): Promise<R> => {
  try {
    return await local(...a)
  } catch (e) {
    let saved: R
    try {
      saved = await wire(...a)
    } catch {
      throw e
    }
    off()
    return saved
  }
}

let close: (() => void) | undefined

export let disarm = () => {
  arm.mutate = undefined
  arm.query =
    arm.work =
    arm.deps =
    arm.search =
    arm.history =
    arm.historyBy =
    arm.integrity =
    arm.telemetry =
    arm.telemetryStats =
    arm.providers =
      undefined
  close?.()
  close = undefined
}

// The deps=1 layer's edge set, locally: the same depsOf + quarantine screen
// the /query route runs (reveal lifts it there; the local arm never asks).
let localDeps = (db: DatabaseSync): DepsFn =>
// deno-lint-ignore require-await
async (eids, reveal = false) =>
  depsOf(db, eids).filter((d) =>
    reveal ||
    (!eager(db, d.parent).quarantined && !eager(db, d.child).quarantined)
  )

// Arm the process, or leave it wire-only: a path that will not open read-only
// (missing file, an un-recovered WAL needing write access) is simply not
// armed — the wire remains, and nothing is worse than before. Mirrors
// connect()'s refusal to touch the live graph under a test main module.
export let armLocal = (path = envPath()): boolean => {
  disarm()
  if (!path) return false
  if (
    Deno.mainModule.endsWith('_test.ts') && sameGraphFile(path, liveDb())
  ) return false
  let db: DatabaseSync
  let writer: DatabaseSync | undefined
  try {
    db = new DatabaseSync(path, { readOnly: true })
    db.exec('pragma busy_timeout = 5000')
  } catch {
    return false
  }
  close = () => {
    writer?.close()
    db.close()
  }
  // deno-lint-ignore require-await
  arm.mutate = async (mutation, via) => {
    // SQLITE_OPEN_CREATE is off: a missing graph is never silently replaced.
    if (!writer) {
      writer = new DatabaseSync(path, { create: false })
      writer.exec('pragma busy_timeout = 5000')
    }
    if (writer.version != schemaVersion) {
      throw new Error(
        `local database schema version ${writer.version} does not match ` +
          `CLI version ${schemaVersion}; use matching code or TASKS_LOCAL=0`,
      )
    }
    return mutate(writer, mutation, fed(), via)
  }
  arm.query = guarded(localQuery(db), httpQuery)
  let query = localQuery(db)
  arm.work = guarded(
    (lane, opts) =>
      workCandidates(
        {
          query,
          get: (ids) => query(ids.length ? [`id=${ids.join(',')}`] : []),
        },
        lane as WorkLane,
        opts,
      ),
    httpWork,
  )
  arm.deps = guarded(localDeps(db), httpDeps)
  arm.history = guarded(
    (eid, limit) => journalOf(db, eid, limit),
    httpHistory,
  )
  arm.historyBy = guarded(
    (via, limit) => journalBy(db, via, limit),
    httpHistoryBy,
  )
  arm.integrity = guarded(() => scanAnomalies(db), httpIntegrity)
  arm.telemetry = guarded((opts) => recent(db, opts), httpTelemetry)
  arm.telemetryStats = guarded((opts) => stats(db, opts), httpTelemetryStats)
  // The spawn catalog is graph data (catalog.ts), so a CLI beside the graph
  // reads its own manual's model list from the file — no server, no round trip.
  arm.providers = () => catalog(db)
  // Search is the text form of query, so the query arm above covers it too.
  arm.search = undefined
  return true
}
