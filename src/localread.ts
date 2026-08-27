// The CLI's local-read arm (T-22497, D-22388 step 2a): when this process
// stands beside the graph file itself, pure reads answer from the db —
// read-only, in-process, the same query pipeline the server runs — and a
// stopped or busy server stops being a read dependency. Writes never ride the
// arm: /apply stays the one write door, so lease checks, effects and broadcast
// keep one home, and read-triggered stamps (opened, notified) stay wire writes.
//
// Eligibility is the caller's own naming, decided by armPath(): an explicit
// DB_PATH names a graph FILE (probe discipline pairs it with a probe server),
// so local reads are exactly right; an explicit TASKS_HOST with no DB_PATH
// names a SERVER whose file this process cannot know, so every read stays on
// the wire; neither set names the live pairing (liveDb ↔ the default host).
// ':memory:' never arms — a private empty db is not the server's memory graph
// — and TASKS_LOCAL=0 turns the arm off outright.
//
// The db opens READ-ONLY (sqlite.ts Options) and never migrates: schema changes
// belong to an explicit open() at process boot (D-22388).
// Version skew needs no handshake — a query against a schema this build does
// not know throws, guarded() answers it over the wire and disarms, and the
// local error only surfaces when the wire fails too, so a dead server still
// reports the local truth (a filter typo, not ECONNREFUSED).
import { DatabaseSync } from './sqlite.ts'
import { resolve } from 'node:path'
import {
  depsOf,
  eager,
  journalBy,
  journalOf,
  liveDb,
  scanAnomalies,
} from './db.ts'
import { localQuery } from './graph_query.ts'
import {
  arm,
  type DepsFn,
  httpDeps,
  httpHistory,
  httpHistoryBy,
  httpIntegrity,
  httpQuery,
  httpTelemetry,
  httpTelemetryStats,
} from './client.ts'
import { recent, stats } from './telemetry.ts'

// Where the arm may read, or undefined for wire-only. Pure over its inputs —
// no env defaults, so the decision table tests without an environment — and
// envPath is the one reader of the process's own naming.
export let armPath = (env: {
  dbPath?: string
  hostSet?: boolean
  disabled?: boolean
  live: string
}): string | undefined =>
  env.disabled || env.dbPath == ':memory:'
    ? undefined
    : env.dbPath ?? (env.hostSet ? undefined : env.live)

let envPath = () =>
  armPath({
    dbPath: Deno.env.get('DB_PATH'),
    hostSet: !!Deno.env.get('TASKS_HOST'),
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

export let disarm = () => {
  arm.query =
    arm.deps =
    arm.search =
    arm.history =
    arm.historyBy =
    arm.integrity =
    arm.telemetry =
    arm.telemetryStats =
      undefined
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
  if (!path) return false
  if (
    Deno.mainModule.endsWith('_test.ts') && resolve(path) == resolve(liveDb())
  ) return false
  let db: DatabaseSync
  try {
    db = new DatabaseSync(path, { readOnly: true })
    db.exec('pragma busy_timeout = 5000')
  } catch {
    return false
  }
  arm.query = guarded(localQuery(db), httpQuery)
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
  // Search is the text form of query, so the query arm above covers it too.
  arm.search = undefined
  return true
}
