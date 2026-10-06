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
  let errors = rows.some((row) => row?.error)
  for (let row of rows) {
    if (!row?.entity || !eid.test(row.entity.eid) || row.$delete || row.$was) {
      throw Error('tracker queue expects immutable global entities')
    }
    let during = row.during
    let space = during && typeof during == 'object' && 'space' in during
      ? during.space
      : undefined
    if (space != null && (typeof space != 'string' || !eid.test(space))) {
      throw Error('tracker space must be a global eid')
    }
    if (row.trace || row.span) {
      // A capture can exceed one queue message, and messages can arrive out
      // of order. Every span chunk therefore carries its own trusted scope.
      if (typeof space != 'string') {
        throw Error('tracker trace entities require a global space')
      }
      let span = row.span
      if (
        span && (typeof span != 'object' || !('trace' in span) ||
          typeof span.trace != 'string' || !eid.test(span.trace) ||
          ('parent' in span && span.parent != null &&
            (typeof span.parent != 'string' || !eid.test(span.parent))))
      ) {
        throw Error('tracker span references must be global eids')
      }
      scopes.add(space)
    } else if (row.error) {
      scopes.add(typeof space == 'string' ? space : platform)
    } else if (!errors) {
      throw Error('tracker batch expects errors or trace entities')
    }
    // Error companions may omit context, but may not smuggle a second scope.
    if (typeof space == 'string') scopes.add(space)
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
