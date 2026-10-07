/** Minute summaries and stored span entities. Hosts supply epoch origins,
 * trace identities and tracker context; this package never reads a clock. */
import type { Kind, Outcome } from '@yaks/trace'
import type { Ran } from './ran.ts'

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

/** A selected operation. Its spans refer to this entity, not to a JSON tree. */
export type Trace = { op: Kind; name: string; at: string }

/** One span's code metadata and references within its stored trace. */
export type StoredSpan = {
  trace: string
  parent?: string
  op: Kind
  name: string
  plugin?: string
  package?: string
  outcome?: Outcome
}

/** Tracker context is supplied by the host, never obtained through a read. */
export type During = {
  entity?: string
  app?: string
  space?: string
  process?: string
  request?: string
  kind?: string
}

/** Each measurement is a separate component on its span's entity. */
export type TraceRow = {
  entity: { eid: string }
  during?: During
  trace?: Trace
  span?: StoredSpan
  elapsed?: { start: number; ms?: number }
  rows_read?: { n: number }
  rows_written?: { n: number }
  statements?: { n: number; ran?: Ran[] }
  repeats?: { n: number }
}

/** Epoch milliseconds at monotonic time zero, normally performance.timeOrigin. */
export type Clock = { origin: number }

/** Milliseconds since epoch rounded down to the UTC minute. */
export let minute = (at: number): number => Math.floor(at / 60_000) * 60_000
