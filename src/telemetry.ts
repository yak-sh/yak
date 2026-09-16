// What the tools are actually doing: every MCP tool call, HTTP write,
// browser crash, and background sync that couldn't land in `tool_call` —
// who called what, how long it took, whether it worked.
//
// @yaks/telemetry owns all of it: the table and its source CHECK, the
// scrubbing on write, the error cohorts on read, the MCP body classifier, and
// the contract that record() never throws. This file is the fleet's seat at
// that package and nothing else — the package's calls, over a fleet handle.
// SERVER-ONLY.
import {
  type Call,
  type Filter,
  type Log,
  recent as readRecent,
  record as append,
  type Stat,
  stats as readStats,
} from '@yaks/telemetry'
import { driverOf } from './store/driver.ts'
import type { Sql } from './store/sql.ts'

export type { Call, Log, Stat }
export { fingerprint, outcome, schema, toolCall } from '@yaks/telemetry'

export let record = (db: Sql, c: Call) => append(driverOf(db), c)

export let recent = (db: Sql, f: Filter & { limit?: number } = {}): Log[] =>
  readRecent(driverOf(db), f)

export let stats = (db: Sql, f: Filter = {}): Stat[] =>
  readStats(driverOf(db), f)
