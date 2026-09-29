// The kernel-only door onto a Store's kept writes. A reset can leave an
// interrupted write to inspect and explicitly retry after its cause is fixed.
import type { Door } from './door.ts'
import { KERNEL } from './meta.ts'
import { rejected } from './tool.ts'

export type Write = {
  seq: number
  at: string
  state: string
  tries: number
  why?: string
  body?: string
  idempotency_key?: string
  answer?: string
  status?: number
}

let asked = (
  store: Door,
  path: string,
  method = 'GET',
  replayable = true,
) => {
  return store.consume(
    path,
    async (r) => {
      let body = await r.json() as
        | Write[]
        | { writes: Write[]; seq: number }
        | {
          message?: string
        }
      if (!r.ok) {
        throw rejected(r.status, 'message' in body ? body.message ?? '' : '')
      }
      return body
    },
    { method },
    KERNEL,
    { replayable },
  )
}

export let inspect = async (store: Door, seq?: number): Promise<Write[]> =>
  await asked(store, `/writes${seq == null ? '' : `?seq=${seq}`}`) as Write[]

export let retry = async (store: Door, seq: number): Promise<Write[]> =>
  (await asked(store, `/writes?seq=${seq}`, 'POST', false) as {
    writes: Write[]
  }).writes
