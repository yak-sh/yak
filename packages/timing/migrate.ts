/** Rehearsal-only projection of a legacy JSON trace to linked span entities.
 * Hosts expand the vocabulary before applying its patches; no store is opened
 * here. Unknown metrics are refused rather than silently lost or mislabelled. */
import type { Bundle } from '@yaks/graph'
import type { Kind, Outcome } from '@yaks/trace'
import type { During, TraceRow } from './model.ts'
import { project } from './project.ts'

export type LegacyTrace = {
  op: Kind
  name: string
  at: string
  ms: number
  spans: {
    id: string
    parent?: string
    kind: Kind
    name: string
    plugin?: string
    start: number
    ms?: number
    outcome?: Outcome
    counts?: Readonly<Record<string, number>>
  }[]
}

/** Trace root identity and tracker context are preserved. Already converted
 * rows return no patches, so a rehearsal or an approved migration is resumable. */
export let migrateTrace = (row: {
  entity: { eid: string }
  trace?: LegacyTrace | Partial<LegacyTrace>
  during?: During
}): Bundle[] => {
  let old = row.trace
  if (!old || old.spans == null) return []
  if (!old.op || !old.name || !old.at || !Number.isFinite(Date.parse(old.at))) {
    throw Error('legacy trace requires code metadata and a valid start time')
  }
  if (!old.spans.length) throw Error('legacy trace has no root span')
  let root = old.spans[0]
  if (root.parent != null || root.start != 0 || root.ms != old.ms) {
    throw Error(
      'legacy trace root must preserve its duration and zero-relative start',
    )
  }
  let ids = new Set(old.spans.map((span) => span.id))
  if (ids.size != old.spans.length) {
    throw Error('legacy trace has duplicate span ids')
  }
  for (let span of old.spans) {
    if (span.parent != null && !ids.has(span.parent)) {
      throw Error('legacy trace has an unknown parent span')
    }
    for (let metric of Object.keys(span.counts ?? {})) {
      if (!['rowsRead', 'rowsWritten', 'statements'].includes(metric)) {
        throw Error(
          `legacy trace metric ${metric} needs its own component before migration`,
        )
      }
    }
  }
  let rows: TraceRow[] = project(
    old.spans.map((span) => ({
      id: span.id,
      parent: span.parent,
      kind: span.kind,
      name: span.name,
      plugin: span.plugin,
      start: span.start,
      time: span.start + (span.ms ?? 0),
      stage: span.ms == null ? 'start' : 'end',
      duration: span.ms,
      outcome: span.outcome,
      counts: span.counts,
    })),
    { origin: Date.parse(old.at), eid: row.entity.eid, during: row.during },
  )
  // Keep the original metadata exactly; the legacy relative root start is zero.
  rows[0].trace = { op: old.op, name: old.name, at: old.at }
  return [{
    ...rows[0],
    trace: { ...rows[0].trace, ms: null, spans: null },
  }, ...rows.slice(1)]
}
