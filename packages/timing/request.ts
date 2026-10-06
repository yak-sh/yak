/** Select one Store request from its measured rows or host-supplied trigger.
 * Hosts keep the returned source quota only in memory, never in Store rows. */
import type { Event } from '@yaks/trace'
import type { TraceRow } from './model.ts'
import { project, type ProjectOptions } from './project.ts'
import { cap } from './cap.ts'

export type RequestSelection = {
  rowsRead: number
  rowsWritten: number
  requested?: boolean
  /** Probability in [0, 1]; absent means ordinary sampling is off. */
  rate?: number
  /** A host-supplied random draw in [0, 1). */
  random?: number
}

let sampled = (options: RequestSelection): boolean => {
  let rate = options.rate ?? 0
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new RangeError('request sample rate must be in [0, 1]')
  }
  if (rate == 0) return false
  if (rate == 1) return true
  let draw = options.random
  if (draw == null || !Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new RangeError('request sampling requires a random draw in [0, 1)')
  }
  return draw < rate
}
let over = (options: RequestSelection): boolean =>
  options.rowsRead > 10_000 || options.rowsWritten > 10_000

/** Stateless trigger check for hosts without the Store's automatic quota.
 * Store hosts use selectRequest() so repeated over-the-line work is bounded. */
export let selectedRequest = (options: RequestSelection): boolean => {
  // Validate rate even when another trigger selects the request, retaining the
  // stateless API's invalid-config contract without requiring a random draw.
  let rate = options.rate ?? 0
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new RangeError('request sample rate must be in [0, 1]')
  }
  return !!options.requested || over(options) || sampled(options)
}

export type RequestReason = 'requested' | 'sampled' | 'automatic'
export type RequestQuota = { at?: number; repeats: number }
export type RequestState = ReadonlyMap<string, RequestQuota>
export type GatedRequest = RequestSelection & {
  /** The root's code coordinates, not the request URL or query. */
  op: string
  name: string
  /** Completion time in epoch milliseconds, supplied by the host. */
  now: number
}
export type RequestDecision = {
  reason?: RequestReason
  /** Suppressed automatic occurrences since the prior selected trace. */
  repeats: number
  state: RequestState
}

/** Keep at most one automatic trace per code coordinate in a rolling hour.
 * Explicit captures and random samples are independent reasons: they bypass
 * this quota, but do not re-arm it. Suppressed automatic occurrences ride the
 * next selected trace of the same coordinate, including a sample or capture.
 * Inputs remain unchanged; state belongs to one Store incarnation. */
export let selectRequest = (
  options: GatedRequest,
  state: RequestState = new Map(),
): RequestDecision => {
  if (!Number.isFinite(options.now)) {
    throw new RangeError('request time must be finite')
  }
  let key = JSON.stringify([options.op, options.name])
  let previous = state.get(key)
  let reason: RequestReason | undefined = options.requested
    ? 'requested'
    : sampled(options)
    ? 'sampled'
    : undefined
  let next = previous
  if (!reason && over(options)) {
    if (previous?.at == null || options.now - previous.at >= 3_600_000) {
      reason = 'automatic'
      next = { at: options.now, repeats: 0 }
    } else {
      next = {
        at: previous.at,
        repeats: Math.min(Number.MAX_SAFE_INTEGER, previous.repeats + 1),
      }
    }
  }
  let repeats = reason ? previous?.repeats ?? 0 : 0
  if (reason && reason != 'automatic' && previous?.repeats) {
    next = { at: previous.at, repeats: 0 }
  }
  if (next === previous) return { reason, repeats, state }
  let changed = new Map(state)
  changed.set(key, next!)
  return { reason, repeats, state: changed }
}

export type RequestOptions = ProjectOptions & RequestSelection

/** An unselected request produces no delivery bundles. Completed selected
 * requests use exactly the same projection as the box's slow-tree sampler. */
export let sampleRequest = (
  spans: readonly Event[],
  options: RequestOptions,
): TraceRow[] | undefined => {
  let root = spans[0]
  if (!root || root.stage == 'start' || !selectedRequest(options)) return
  return project(cap(spans), options)
}
