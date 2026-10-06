/** Select one Store request from its measured rows or host-supplied trigger.
 * Selection is pure: random draws, request quotas and delivery belong to hosts. */
import type { Event } from '@yaks/trace'
import type { TraceRow } from './model.ts'
import { project, type ProjectOptions } from './project.ts'

export type RequestSelection = {
  rowsRead: number
  rowsWritten: number
  requested?: boolean
  /** Probability in [0, 1]; absent means ordinary sampling is off. */
  rate?: number
  /** A host-supplied random draw in [0, 1). */
  random?: number
}

/** Every request strictly above 10,000 read OR written rows is selected. */
export let selectedRequest = (options: RequestSelection): boolean => {
  let rate = options.rate ?? 0
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new RangeError('request sample rate must be in [0, 1]')
  }
  if (
    options.requested || options.rowsRead > 10_000 ||
    options.rowsWritten > 10_000
  ) {
    return true
  }
  if (rate == 0) return false
  if (rate == 1) return true
  let draw = options.random
  if (draw == null || !Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new RangeError('request sampling requires a random draw in [0, 1)')
  }
  return draw < rate
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
  return project(spans, options)
}
