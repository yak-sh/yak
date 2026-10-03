// Owner-only inspection of one Store's physical size and a kept write's dry
// run cost. The Store answers counts and timings; no rows or SQL cross here.

import type { Identity, StoreSize } from '@yaks/sqlite'
import type { Event } from '@yaks/trace'
import type { Door } from './door.ts'
import { KERNEL } from './meta.ts'
import { rejected } from './tool.ts'

export type Inspection = {
  physical?: StoreSize
  identity?: Identity
  dryRun?: {
    seq: number
    status: number
    bundles: number | null
    ms: number
    phases: Record<string, number>
  }
}

// Pipeline totals include their plugin hooks already; audit and effect spans
// are outside the dry-run phase contract. Repeated gathers/transactions add up.
export let phases = (spans: readonly Event[]): Record<string, number> => {
  let out: Record<string, number> = {}
  for (let span of spans) {
    if (
      span.kind != 'phase' || span.stage != 'end' ||
      span.package != '@yaks/graph' || span.plugin ||
      span.name == 'audit' || span.name == 'effect'
    ) continue
    out[span.name] = (out[span.name] ?? 0) + span.duration!
  }
  return out
}

export let inspect = async (
  store: Door,
  seq?: number,
  eid?: string,
): Promise<Inspection> => {
  let query = new URLSearchParams()
  if (seq != null) query.set('seq', String(seq))
  if (eid != null) query.set('eid', eid)
  let r = await store(`/inspect?${query}`, {}, KERNEL)
  let result = await r.json() as Inspection & { message?: string }
  if (!r.ok) throw rejected(r.status, result.message ?? '')
  return result
}
