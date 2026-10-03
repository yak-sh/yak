/** Completed events become closed-minute bundles. Fixed histogram boundaries
 * make distributions additive across processes without retaining individual
 * durations. Start events carry no measurement and are ignored. */
import { derivedEid } from '@yaks/graph'
import type { Event } from '@yaks/trace'
import { type Clock, minute, type TimingRow } from './model.ts'

/** Positive bucket upper bounds in ms, from 2^-10 through 2^30. Bucket zero
 * holds exact zero; the final bucket holds durations beyond the last bound. */
export let bounds: readonly number[] = Object.freeze(
  Array.from({ length: 41 }, (_, i) => 2 ** (i - 10)),
)

/** Summary context. before is epoch ms; only minutes ending at or before it
 * are returned. Each process supplies a unique process eid for its lifetime. */
export type SummaryOptions = Clock & {
  process: string
  before: number
  commit?: string
}

let bucket = (ms: number): number => {
  if (ms == 0) return 0
  let lo = 0
  let hi = bounds.length
  while (lo < hi) {
    let mid = (lo + hi) >>> 1
    if (ms <= bounds[mid]) hi = mid
    else lo = mid + 1
  }
  return lo + 1
}

/** Summarize a channel's events once, attributing each completed span or
 * instant to its completion minute. Omit open minutes, even with completed
 * spans in them. The caller retains those events until that minute closes. */
export let summarize = (
  events: readonly Event[],
  options: SummaryOptions,
): TimingRow[] => {
  let rows = new Map<string, TimingRow>()
  let closed = minute(options.before)
  for (let e of events) {
    if (e.stage == 'start') continue
    let ms = e.stage == 'instant' ? 0 : e.duration
    if (ms == null) continue
    let at = minute(options.origin + e.time)
    if (at >= closed) continue
    let key = JSON.stringify([
      options.process,
      e.kind,
      e.name,
      e.plugin ?? '',
      new Date(at).toISOString(),
    ])
    let row = rows.get(key)
    if (!row) {
      row = {
        entity: { eid: derivedEid(`timing|${key}`) },
        during: { process: options.process },
        timing: {
          op: e.kind,
          name: e.name,
          plugin: e.plugin ?? '',
          at: new Date(at).toISOString(),
          n: 0,
          total: 0,
          max: 0,
          buckets: Array(bounds.length + 2).fill(0),
          counts: {},
          ...options.commit != null ? { commit: options.commit } : {},
        },
      }
      rows.set(key, row)
    }
    let t = row.timing
    t.n++
    t.total += ms
    t.max = Math.max(t.max, ms)
    t.buckets[bucket(ms)]++
    for (let [name, n] of Object.entries(e.counts ?? {})) {
      Object.defineProperty(t.counts, name, {
        value: (Object.hasOwn(t.counts, name) ? t.counts[name] : 0) + n,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
  }
  return [...rows.values()]
}
