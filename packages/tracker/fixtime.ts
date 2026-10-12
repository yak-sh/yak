// Time to fix: how long a bug stayed open before it was resolved. A bug that
// came back is timed from its regression, since that is when it reopened.
// It is computed from the bug's marks and never stored.

import type { Bundle, Comp } from '@yaks/graph'

let at = (b: Bundle, name: string, prop = 'at'): number =>
  Date.parse(String((b[name] as Comp | undefined)?.[prop] ?? ''))

/// opened({ entity: { eid: 'b' }, bug: { first: '2026-10-12T10:00:00Z' } })
///   -> Date.parse('2026-10-12T10:00:00Z')
/// opened({ entity: { eid: 'b' }, bug: { first: '2026-10-01T00:00:00Z' },
///   regressed: { at: '2026-10-12T10:00:00Z' } })
///   -> Date.parse('2026-10-12T10:00:00Z')
/** When the bug last opened: its regression, else its first occurrence. */
export let opened = (b: Bundle): number => {
  let first = at(b, 'bug', 'first'), back = at(b, 'regressed')
  return back > first ? back : first
}

/// fixtime({ entity: { eid: 'b' }, bug: { first: '2026-10-12T10:00:00Z' },
///   resolved: { at: '2026-10-12T10:04:00Z' } })
///   -> 240_000
/// fixtime({ entity: { eid: 'b' }, bug: { first: '2026-10-12T10:00:00Z' } })
///   -> undefined
/** How long a resolved bug was open; undefined while it is open or when it
 * was archived instead. */
export let fixtime = (b: Bundle): number | undefined => {
  if (!b.resolved) return undefined
  let span = at(b, 'resolved') - opened(b)
  return span >= 0 ? span : undefined
}

/// span(42_000) -> '42s'
/// span(4 * 60_000) -> '4m'
/// span(72 * 60_000) -> '1h12m'
/// span(76 * 3_600_000) -> '3d4h'
/** A duration to the two largest units that matter for a bug. */
export let span = (ms: number): string => {
  let s = Math.round(ms / 1000), m = Math.floor(s / 60)
  let h = Math.floor(m / 60), d = Math.floor(h / 24)
  return d
    ? `${d}d${h % 24 ? `${h % 24}h` : ''}`
    : h
    ? `${h}h${m % 60 ? `${m % 60}m` : ''}`
    : m
    ? `${m}m`
    : `${s}s`
}

export type Fixes = {
  /** resolved bugs with a measurable time to fix */
  count: number
  median?: number
  worst?: { ms: number; bug: Bundle }
}

/// let bug = (h, m) => ({ entity: { eid: `${h}:${m}` },
///   bug: { first: `2026-10-12T${h}:00:00Z` },
///   resolved: { at: `2026-10-12T10:${m}:00Z` } })
/// let four = fixes([bug(10, '01'), bug(10, '03'), bug('09', '00'), bug(10, '05')])
/// [four.count, four.median, four.worst?.ms] -> [4, 240_000, 3_600_000]
/// fixes([]) -> { count: 0 }
/** Median and worst time to fix over resolved bugs. */
export let fixes = (rows: Bundle[]): Fixes => {
  let timed = rows.flatMap((bug) => {
    let ms = fixtime(bug)
    return ms == undefined ? [] : [{ ms, bug }]
  }).sort((a, b) => a.ms - b.ms)
  let n = timed.length
  if (!n) return { count: 0 }
  let mid = n >> 1
  return {
    count: n,
    median: n % 2 ? timed[mid].ms : (timed[mid - 1].ms + timed[mid].ms) / 2,
    worst: timed[n - 1],
  }
}
