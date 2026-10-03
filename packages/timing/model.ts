/** Minute summaries and stored trees. Time enters as an explicit epoch origin
 * for the trace channel's monotonic clock; this package never reads a clock. */
import type { Counts, Kind, Outcome } from '@yaks/trace'

/** One completed minute's measurements of one piece of code. */
export type Timing = {
  op: Kind
  name: string
  plugin: string
  at: string
  n: number
  total: number
  max: number
  buckets: number[]
  counts: Record<string, number>
  commit?: string
}

/** A summary bundle, identified by its process and minute's code coordinates. */
export type TimingRow = {
  entity: { eid: string }
  during: { process: string }
  timing: Timing
}

/** A span projected to code metadata and times relative to its tree's root.
 * An unfinished descendant has no ms; an instant has ms zero. */
export type TraceSpan = {
  id: string
  parent?: string
  kind: Kind
  name: string
  plugin?: string
  start: number
  ms?: number
  outcome?: Outcome
  counts?: Counts
}

/** A selected tree's trace component, ready to sit beside tracker context. */
export type Trace = {
  op: Kind
  name: string
  at: string
  ms: number
  spans: TraceSpan[]
}

/** Epoch milliseconds at monotonic time zero, normally performance.timeOrigin. */
export type Clock = { origin: number }

/** Milliseconds since epoch rounded down to the UTC minute. */
export let minute = (at: number): number => Math.floor(at / 60_000) * 60_000
