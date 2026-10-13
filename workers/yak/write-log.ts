// The kernel-only door onto a Store's kept writes. A reset can leave an
// interrupted write to inspect and explicitly retry after its cause is fixed.
import type { Door } from './door.ts'
import { KERNEL } from './meta.ts'
import { rejected } from './tool.ts'

export type Write = {
  seq: number
  kernel: boolean
  at: string
  state: string
  tries: number
  /** 1 once store_retry asked for it again, so its outcome is kept */
  audit?: number
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

export let inspect = async (
  store: Door,
  seq?: number,
  recent = false,
): Promise<Write[]> => {
  let query = new URLSearchParams()
  if (seq != null) query.set('seq', String(seq))
  if (recent) query.set('recent', '1')
  return await asked(store, `/writes?${query}`) as Write[]
}

export let retry = async (store: Door, seq: number): Promise<Write[]> =>
  (await asked(store, `/writes?seq=${seq}`, 'POST', false) as {
    writes: Write[]
  }).writes

/**
 * Kept writes as store_writes and store_retry say them, one line each, with
 * every field their data carries; a write named by its seq adds its key, its
 * body and its outcome. Some hosts show their model only these words.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = '2026-10-13T12:00:00Z'
 * assertEquals(
 *   said([{ seq: 3, kernel: true, at, state: 'interrupted', tries: 1 }]),
 *   `3: interrupted, 1 attempt, ${at}, sent by the platform`,
 * )
 * ```
 */
export let said = (rows: Write[], whole = false) =>
  rows.map((r) =>
    `${r.seq}: ${r.state}, ${r.tries} ${
      r.tries == 1 ? 'attempt' : 'attempts'
    }, ${r.at}${r.kernel ? ', sent by the platform' : ''}${
      r.audit ? ', retried by store_retry' : ''
    }${!whole && r.status != null ? `, answered ${r.status}` : ''}${
      r.why ? ` — ${r.why}` : ''
    }${
      whole
        ? `${
          r.idempotency_key ? `\nIdempotency key: ${r.idempotency_key}` : ''
        }\nOriginal body:\n${r.body ?? ''}\nOutcome (${
          r.status ?? 'pending'
        }):\n${r.answer ?? ''}`
        : ''
    }`
  ).join('\n')
