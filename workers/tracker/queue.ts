// Only the trusted server queue chooses a store. A message is one complete
// graph batch: mixed spaces are rejected before any object receives it.

import type { Bundle } from '@yaks/graph'
import { platform } from './core.ts'

export type Message = {
  body: unknown
  ack: () => void
  retry: () => void
}
export type Destination = { ingest: (rows: Bundle[]) => Promise<void> }
let eid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export let batch = (body: unknown): { scope: string; rows: Bundle[] } => {
  if (!Array.isArray(body) || !body.length || body.length > 100) {
    throw Error('tracker queue expects 1..100 bundles')
  }
  let rows: Bundle[] = body
  let scopes = new Set<string>()
  for (let row of rows) {
    if (!row?.entity || !eid.test(row.entity.eid) || row.$delete || row.$was) {
      throw Error('tracker queue expects immutable global entities')
    }
    if (row.error) {
      let during = row.during
      let space = during && typeof during == 'object' && 'space' in during
        ? during.space
        : undefined
      if (space != null && (typeof space != 'string' || !eid.test(space))) {
        throw Error('tracker space must be a global eid')
      }
      scopes.add(typeof space == 'string' ? space : platform)
    }
  }
  if (scopes.size != 1) throw Error('tracker batch must name exactly one store')
  return { scope: [...scopes][0], rows }
}
export let consume = async (
  messages: Message[],
  destination: (scope: string) => Destination,
  report: (error: unknown) => Promise<void>,
): Promise<void> => {
  for (let message of messages.slice(0, 100)) {
    try {
      let { scope, rows } = batch(message.body)
      await destination(scope).ingest(rows)
      message.ack()
    } catch (error) {
      message.retry()
      try {
        await report(error)
      } catch { /* intake still retries */ }
    }
  }
  for (let message of messages.slice(100)) message.retry()
}
