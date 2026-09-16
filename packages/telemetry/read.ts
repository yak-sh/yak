// Reading the log back: the recent page, newest first, and the latency
// distribution per door and tool. This is a debugging door, not a bulk export,
// so the page clamps at a hard cap and cohorting happens inside that window.

import type { Driver, Param } from './driver.ts'
import { TABLE } from './ddl.ts'
import { cohort, type Log } from './cohort.ts'

/** The filters both reads take. */
export type Filter = { since?: string; only?: string }

/** The most rows one read returns. */
export let PAGE = 500

let clause = ({ since, only }: Filter) => {
  let where: string[] = []
  let args: Param[] = []
  if (since) {
    where.push('ts >= ?')
    args.push(since)
  }
  if (only == 'errors') where.push('ok = 0')
  return { where, args }
}

/**
 * Newest first, errors folded into counted cohorts. `limit` clamps to
 * [1, {@link PAGE}], 50 when absent. The whole cap is read and cohorted before
 * slicing, so a crash's count is right even when its copies outnumber the page.
 */
export let recent = (
  db: Driver,
  { limit, ...f }: Filter & { limit?: number } = {},
): Log[] => {
  let n = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), PAGE)
  let { where, args } = clause(f)
  let rows = db.query(
    `select ts, source, name, session_id, ok, ms, error, detail from "${TABLE}"
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by ts desc, rowid desc limit ${PAGE}`,
    args,
  ) as Log[]
  return cohort(rows).slice(0, n)
}

/** Latency per (source, name): the count of TIMED calls and their percentiles. */
export type Stat = {
  source: string
  name: string
  n: number
  p50: number
  p95: number
  p99: number
}

/**
 * The latency distribution, computed in SQL. An untimed call (`ms` null)
 * never counts. Needs SQLite's `percentile_cont` (3.53+).
 */
export let stats = (db: Driver, f: Filter = {}): Stat[] => {
  let { where, args } = clause(f)
  return db.query(
    `select source, name, count(*) as n,
       round(percentile_cont(ms, 0.5), 1) as p50,
       round(percentile_cont(ms, 0.95), 1) as p95,
       round(percentile_cont(ms, 0.99), 1) as p99
     from "${TABLE}"
     where ${['ms is not null', ...where].join(' and ')}
     group by source, name
     order by n desc`,
    args,
  ) as Stat[]
}
