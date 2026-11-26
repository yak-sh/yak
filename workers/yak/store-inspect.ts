// Owner-only inspection of one Store's physical size and a kept write's dry
// run cost. The Store answers counts and timings; no rows or SQL cross here.

import type {
  Deletions,
  DeletionWindow,
  Identity,
  StoreSize,
} from '@yaks/sqlite'
import { deletions, identity, inspect as size } from '@yaks/sqlite'
import type { Driver } from '@yaks/sql'
import type { Event } from '@yaks/trace'
import type { Door } from '@yaks/durable-object/door'
import type { Version } from './running.ts'
import { KERNEL } from './meta.ts'
import { rejected } from './tool.ts'

export type Inspection = {
  physical?: StoreSize
  /** The Worker version the store runs. */
  running?: { version: Version | null }
  identity?: Identity
  deletions?: Deletions
  dryRun?: {
    seq: number
    status: number
    bundles: number | null
    ms: number
    phases: Record<string, number>
  }
}

/** Physical inspection needs no graph boot, including while an app is in
 * the trash. A seq asks for graph execution and is handled by the active Store. */
export let physical = (
  db: Driver,
  at: URLSearchParams,
): Inspection | undefined => {
  if (at.has('since') || at.has('until')) {
    return {
      deletions: deletions(db, {
        since: at.get('since') ?? '',
        until: at.get('until') ?? '',
        after: at.has('after') ? Number(at.get('after')) : undefined,
        eids: at.get('eids') == '1',
      }),
    }
  }
  let eid = at.get('eid')
  if (eid) return { identity: identity(db, eid) }
  if (!at.has('seq')) return { physical: size(db) }
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
  options: { seq?: number; eid?: string; deletions?: DeletionWindow } = {},
): Promise<Inspection> => {
  let { seq, eid, deletions } = options
  let query = new URLSearchParams()
  if (seq != null) query.set('seq', String(seq))
  if (eid != null) query.set('eid', eid)
  if (deletions) {
    query.set('since', deletions.since)
    query.set('until', deletions.until)
    if (deletions.after != null) query.set('after', String(deletions.after))
    if (deletions.eids) query.set('eids', '1')
  }
  return await store.consume(
    `/inspect?${query}`,
    async (r) => {
      let result = await r.json() as Inspection & { message?: string }
      if (!r.ok) throw rejected(r.status, result.message ?? '')
      return result
    },
    {},
    KERNEL,
  )
}
