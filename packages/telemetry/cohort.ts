// Folding repeats. N copies of one crash read as ONE counted row: a cohort key
// is an error's CLASS, its door, and the SHAPE of its top stack frames, never
// the variable message. Frames drop their line:col so a rebuild that shifts
// every line still cohorts. Successful calls pass through untouched: each
// timed call is its own datum.

import type { Source } from './ddl.ts'

/**
 * A row read back. A run of identical errors reads as one row carrying the
 * cohort's count and span; the extra fields are absent on a lone row.
 */
export type Log = {
  ts: string
  source: Source | string
  name: string
  session_id: string | null
  ok: number
  ms: number | null
  error: string | null
  detail: string | null
  count?: number
  first?: string
  last?: string
}

let errClass = (error: string): string =>
  error.split('\n', 1)[0].match(/[\w.$]*(?:Error|Exception)\b/)?.[0] ?? ''

let frames = (detail: string | null): string =>
  (detail ?? '')
    .split('\n')
    .filter((l) => /\bat\b|@/.test(l))
    .slice(0, 5)
    .map((l) => l.replace(/:\d+:\d+/g, '').trim())
    .join('|')

/** The deterministic cohort key of a row. */
export let fingerprint = (r: Log): string => {
  let cls = errClass(r.error ?? '')
  let fr = frames(r.detail)
  let body = cls || fr ? `${cls}\n${fr}` : (r.error ?? '').split('\n', 1)[0]
  return `${r.source}\n${r.name}\n${body}`
}

/**
 * Collapse repeated errors, newest-first in and out. The first sighting of a
 * key is the cohort's `last`; every later sighting walks `first` back.
 */
export let cohort = (rows: Log[]): Log[] => {
  let seen = new Map<string, Log>()
  let out: Log[] = []
  for (let r of rows) {
    if (r.ok) {
      out.push(r)
      continue
    }
    let key = fingerprint(r)
    let hit = seen.get(key)
    if (hit) {
      hit.count = (hit.count ?? 1) + 1
      hit.first = r.ts
    } else {
      let rep = { ...r, count: 1, first: r.ts, last: r.ts }
      seen.set(key, rep)
      out.push(rep)
    }
  }
  for (let r of out) {
    if (r.count == 1) {
      delete r.count
      delete r.first
      delete r.last
    }
  }
  return out
}
