// Only the trusted server queue chooses a store. A message is one complete
// graph batch: mixed spaces are rejected before any object receives it.

import type { Bundle } from '@yaks/graph'
import { minted } from '@yaks/graph/identity'
import { platform } from './core.ts'
import { traceBatch } from '@yaks/tracker/intake'
import { stopped } from '@yaks/durable-object/ceiling'
import { waits } from '@yaks/api'

export type Message = {
  id?: string
  body: unknown
  /** how many times the queue has delivered it, this delivery included */
  attempts?: number
  ack: () => void
  retry: (options?: { delaySeconds: number }) => void
}
/** The seconds a message whose intake failed waits for its next delivery: two
 * after its first, doubling to five minutes. An object that refuses is then
 * asked a few times a minute for each message it holds up, not as fast as the
 * queue delivers, and with the consumer's hundred retries (wrangler.toml) a
 * message outlasts an outage of about eight hours before it is a dead letter. */
export let wait = (attempts = 1) => Math.min(2 ** attempts, 300)
export type Destination = { ingest: (rows: Bundle[]) => Promise<void> }
/** Puts a message's body back on its queue, to arrive `seconds` from now as a
 * new message. */
type Deferred = { body: unknown; seconds: number }
export type Later = ((body: unknown, seconds: number) => Promise<void>) & {
  batch?: (messages: Deferred[]) => Promise<void>
}
// RPC intake keeps the same bundle bound as a single message. Queue batches
// also stay below the provider's byte bound, including room for its envelope.
let packs = <T>(
  items: T[],
  weight: (item: T) => number,
  bound: number,
): T[][] => {
  let out: T[][] = [], held: T[] = [], size = 0
  for (let item of items) {
    let n = weight(item)
    if (held.length && size + n > bound) {
      out.push(held)
      held = []
      size = 0
    }
    held.push(item)
    size += n
  }
  if (held.length) out.push(held)
  return out
}
let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export let batch = (body: unknown): { scope: string; rows: Bundle[] } => {
  if (!Array.isArray(body) || !body.length || body.length > 100) {
    throw Error('tracker queue expects 1..100 bundles')
  }
  let rows: Bundle[] = body
  let scopes = new Set<string>()
  let errors = rows.some((row) => row?.error)
  for (let row of rows) {
    if (
      !row?.entity || typeof row.entity.eid != 'string' ||
      !minted(row.entity.eid) || row.$delete || row.$was
    ) {
      throw Error('tracker queue expects immutable global entities')
    }
    let during = row.during
    let space = during && typeof during == 'object' && 'space' in during
      ? during.space
      : undefined
    if (space != null && (typeof space != 'string' || !uuid.test(space))) {
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
          typeof span.trace != 'string' || !uuid.test(span.trace) ||
          ('parent' in span && span.parent != null &&
            (typeof span.parent != 'string' || !uuid.test(span.parent))))
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
  if (scopes.size != 1) {
    throw Error('tracker batch must name exactly one store')
  }
  return { scope: [...scopes][0], rows }
}
export let consume = async (
  messages: Message[],
  destination: (scope: string) => Destination,
  report: (error: unknown) => Promise<void>,
  reject: (message: Message, error: unknown) => Promise<void>,
  trace?: (scope: string, rows: Bundle[]) => Promise<unknown>,
  later?: Later,
): Promise<void> => {
  // A failed intake is the queue's to retry, each message after its wait, and
  // is said once a batch. `report` never sends through this queue (worker.ts):
  // on 2026-11-10 each failed message's report came back as a message to
  // fail, with no wait, and one refused intake was 685,603 in 25 minutes.
  let told = false
  // An object past its rows (@yaks/durable-object `Stopped`) failed nothing:
  // its message comes back when the window ends, put back on the queue as a
  // new one, so no stop spends a delivery of the hundred it has, lengthens its
  // next failure's wait or makes it a dead letter. Nothing is told of it, and
  // the rest of the batch for that object waits as long without asking it.
  let stops = new Map<string, number>()
  let deferred: { message: Message; seconds: number }[] = []
  let defer = (message: Message, seconds: number) =>
    deferred.push({ message, seconds })
  type Accepted = { message: Message; rows: Bundle[] }
  let scopes = new Map<string, Accepted[]>()
  let tell = async (error: unknown) => {
    if (told) return
    told = true
    try {
      await report(error)
    } catch { /* intake still retries */ }
  }
  let failed = async (message: Message, error: unknown, tracing = false) => {
    message.retry({ delaySeconds: wait(message.attempts) })
    if (!tracing) await tell(error)
  }
  for (let message of messages.slice(0, 100)) {
    let tracing = Array.isArray(message.body) &&
      message.body.some((row) => row?.trace || row?.span)
    if (tracing) {
      try {
        let capture = traceBatch(message.body)
        await trace?.(capture?.scope ?? '', message.body as Bundle[])
        message.ack()
      } catch (error) {
        await failed(message, error, true)
      }
      continue
    }
    try {
      let { scope, rows } = batch(message.body)
      let held = scopes.get(scope) ?? []
      held.push({ message, rows })
      scopes.set(scope, held)
    } catch (error) {
      // Preserve an invalid message before acknowledging it, independently
      // of the valid captures beside it.
      try {
        await reject(message, error)
        message.ack()
      } catch {
        message.retry({ delaySeconds: wait(message.attempts) })
      }
    }
  }
  let deliver = async (scope: string, items: Accepted[]): Promise<void> => {
    let held = stops.get(scope)
    if (held) {
      for (let { message } of items) defer(message, held)
      return
    }
    try {
      let rows = new Map<string, Bundle>()
      for (let item of items) {
        // Intake chooses the last bundle within one capture, and the first
        // delivered capture wins across messages, as separate RPCs did.
        let unique = new Map(item.rows.map((row) => [row.entity.eid, row]))
        for (let [eid, row] of unique) {
          let held = rows.get(eid)
          if (!held || Object.keys(held).every((name) => name == 'entity')) {
            rows.set(eid, row)
          }
        }
      }
      await destination(scope).ingest([...rows.values()])
      for (let { message } of items) message.ack()
    } catch (error) {
      if (stopped(error)) {
        let seconds = waits(error) ?? 1
        stops.set(scope, seconds)
        for (let { message } of items) defer(message, seconds)
      } else if (items.length > 1) {
        await tell(error)
        // Immutable intake makes a resend safe even if its answer was lost.
        // Isolate a bad capture so it cannot hold its neighbors on the queue.
        for (let item of items) await deliver(scope, [item])
      } else await failed(items[0].message, error)
    }
  }
  for (let [scope, items] of scopes) {
    for (let group of packs(items, ({ rows }) => rows.length, 100)) {
      await deliver(scope, group)
    }
  }
  let encoder = new TextEncoder()
  for (
    let group of packs(
      deferred,
      ({ message }) => encoder.encode(JSON.stringify(message.body)).length,
      240_000,
    )
  ) {
    if (later?.batch) {
      try {
        await later.batch(
          group.map(({ message, seconds }) => ({
            body: message.body,
            seconds,
          })),
        )
        for (let { message } of group) message.ack()
      } catch (error) {
        await tell(error)
        for (let { message, seconds } of group) {
          message.retry({ delaySeconds: seconds })
        }
      }
    } else {
      for (let { message, seconds } of group) {
        try {
          if (!later) throw Error('queue republication unavailable')
          await later(message.body, seconds)
          message.ack()
        } catch (error) {
          if (later) await tell(error)
          message.retry({ delaySeconds: seconds })
        }
      }
    }
  }
  for (let message of messages.slice(100)) message.retry()
}
