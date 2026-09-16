// What the tools are actually doing: every MCP tool call, HTTP write,
// browser crash, and background sync that couldn't land in `tool_call` —
// who called what, how long it took, whether it worked.
//
// @yaks/telemetry owns all of it: the table and its source CHECK, the
// scrubbing on write, the error cohorts on read, the MCP body classifier, and
// the contract that record() never throws. This file is the fleet's seat at
// that package and nothing else — it names the one thing a package cannot
// know, how a fleet `Sql` handle answers a statement. SERVER-ONLY.
import {
  type Call,
  type Driver,
  type Filter,
  type Log,
  recent as readRecent,
  record as append,
  type Stat,
  stats as readStats,
} from '@yaks/telemetry'
import type { Sql } from './store/sql.ts'

export type { Call, Log, Stat }
export { fingerprint, outcome, schema, toolCall } from '@yaks/telemetry'

// One driver per handle: the package's two methods over the seam's prepare and
// exec. Bound lazily because record() is handed whatever handle the caller
// holds, including the broken ones its never-throws contract must survive.
let drivers = new WeakMap<Sql, Driver>()
let driver = (db: Sql): Driver => {
  let held = drivers.get(db)
  if (!held) {
    held = {
      query: (sql, params) => db.prepare(sql).all(...params),
      exec: (sql) => db.exec(sql),
    }
    drivers.set(db, held)
  }
  return held
}

export let record = (db: Sql, c: Call) => append(driver(db), c)

export let recent = (db: Sql, f: Filter & { limit?: number } = {}): Log[] =>
  readRecent(driver(db), f)

export let stats = (db: Sql, f: Filter = {}): Stat[] => readStats(driver(db), f)
