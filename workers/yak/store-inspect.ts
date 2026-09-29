// Owner-only inspection of one Store's physical size and a kept write's dry
// run cost. The Store answers counts and timings; no rows or SQL cross here.

import type { StoreSize } from '@yaks/sqlite'
import type { Door } from './door.ts'
import { KERNEL } from './meta.ts'
import { rejected } from './tool.ts'

export type Inspection = {
  physical: StoreSize
  dryRun?: {
    seq: number
    status: number
    bundles: number | null
    ms: number
    phases: Record<string, number>
  }
}

export let inspect = async (store: Door, seq?: number): Promise<Inspection> => {
  let r = await store(`/inspect${seq == null ? '' : `?seq=${seq}`}`, {}, KERNEL)
  let result = await r.json() as Inspection & { message?: string }
  if (!r.ok) throw rejected(r.status, result.message ?? '')
  return result
}
