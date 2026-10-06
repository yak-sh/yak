/** Project a captured tree to immutable, reference-linked span entities.
 * Stable span identities make redelivery idempotent without merging metrics. */
import { derivedEid } from '@yaks/graph'
import type { Event } from '@yaks/trace'
import type { Clock, During, TraceRow } from './model.ts'

export type ProjectOptions = Clock & { eid: string; during?: During }

/** One trace entity followed by its span entities. Each span owns independent
 * metric components; unrecognized counts remain runtime observations only. */
export let project = (
  spans: readonly Event[],
  options: ProjectOptions,
): TraceRow[] => {
  let root = spans[0]
  if (!root) return []
  let start = root.start ?? root.time
  let ids = new Map(spans.map((e) => [
    e.id,
    derivedEid(`span|${JSON.stringify([options.eid, e.id])}`),
  ]))
  let metric = (n?: number) =>
    n != null && Number.isFinite(n) && n >= 0 ? { n } : undefined
  return [
    {
      entity: { eid: options.eid },
      trace: {
        op: root.kind,
        name: root.name,
        at: new Date(options.origin + start).toISOString(),
      },
      ...options.during ? { during: { ...options.during } } : {},
    },
    ...spans.map((e): TraceRow => {
      let read = metric(e.counts?.rowsRead)
      let written = metric(e.counts?.rowsWritten)
      let statements = metric(e.counts?.statements)
      return {
        entity: { eid: ids.get(e.id)! },
        ...options.during ? { during: { ...options.during } } : {},
        span: {
          trace: options.eid,
          ...e.parent != null && ids.has(e.parent)
            ? { parent: ids.get(e.parent)! }
            : {},
          op: e.kind,
          name: e.name,
          ...e.plugin != null ? { plugin: e.plugin } : {},
          ...e.package != null ? { package: e.package } : {},
          ...e.outcome != null ? { outcome: e.outcome } : {},
        },
        elapsed: {
          start: (e.start ?? e.time) - start,
          ...e.stage == 'instant'
            ? { ms: 0 }
            : e.duration != null
            ? { ms: e.duration }
            : {},
        },
        ...read ? { rows_read: read } : {},
        ...written ? { rows_written: written } : {},
        ...statements ? { statements } : {},
      }
    }),
  ]
}
