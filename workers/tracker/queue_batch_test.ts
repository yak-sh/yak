import { equal, ok, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { capture } from '@yaks/tracker/report'
import { Stopped } from '@yaks/durable-object/ceiling'
import { consume, type Later, type Message } from './queue.ts'
import { worker } from './worker.ts'

let rows = (n = 1, space?: string) =>
  Array.from({ length: n }, () =>
    capture(Error('broken'), {
      sink: () => {},
      ...space ? { during: { space } } : {},
    })[0])
let messages = (bodies: unknown[]) => {
  let ack: unknown[] = [], retry: { body: unknown; seconds?: number }[] = []
  let messages: Message[] = bodies.map((body) => ({
    body,
    ack: () => void ack.push(body),
    retry: (o) => void retry.push({ body, seconds: o?.delaySeconds }),
  }))
  return { messages, ack, retry }
}
let take = async (
  bodies: unknown[],
  ingest: (rows: Bundle[], scope: string) => Promise<void>,
  later?: Later,
) => {
  let received = messages(bodies),
    rejected: unknown[] = [],
    reported: unknown[] = []
  await consume(
    received.messages,
    (scope) => ({ ingest: (rows) => ingest(rows, scope) }),
    (error) => Promise.resolve(void reported.push(error)),
    (message) => Promise.resolve(void rejected.push(message.body)),
    undefined,
    later,
  )
  return { ...received, rejected, reported }
}
let platform = rows(), space = crypto.randomUUID(), tenant = rows(1, space)
let bodies = [...Array.from({ length: 100 }, () => rows(2))]
let calls: Bundle[][] = []
let batched = await take(
  bodies,
  (rows) => Promise.resolve(void calls.push(rows)),
)
test('a full queue delivery takes bounded intake batches and preserves every capture before acknowledgement', () => {
  equal(calls.map((rows) => rows.length), [100, 100])
  equal(calls.flat(), bodies.flat())
  equal(batched.ack, bodies)
  equal(batched.retry, [])
})
let scopes: { rows: Bundle[]; scope: string }[] = []
let separated = await take(
  [platform, [], tenant, rows(100)],
  (rows, scope) => Promise.resolve(void scopes.push({ rows, scope })),
)
test('batching preserves per-message validation and separates scopes and bundle bounds', () => {
  equal(separated.rejected, [[]])
  equal(scopes.map((call) => call.rows.length), [1, 100, 1])
  equal(scopes.at(-1)?.scope, space)
  equal(separated.ack.length, 4)
})
let duplicate = { ...platform[0], error: { message: 'changed on resend' } }
let duplicates: Bundle[][] = []
await take(
  [platform, [duplicate]],
  (rows) => Promise.resolve(void duplicates.push(rows)),
)
test('the first delivered immutable capture wins when a batch repeats its identity', () => {
  equal(duplicates, [platform])
})
let good = rows(), poison = rows(), after = rows(), stored: Bundle[][] = []
let isolated = await take([good, poison, after], (rows) => {
  if (rows.some((row) => row.entity.eid == poison[0].entity.eid)) {
    return Promise.reject(Error('bad capture'))
  }
  stored.push(rows)
  return Promise.resolve()
})
test('a bad capture cannot hold adjacent captures and its failure is reported once', () => {
  equal(stored, [good, after])
  equal(isolated.ack, [good, after])
  equal(isolated.retry, [{ body: poison, seconds: 2 }])
  equal(isolated.reported.length, 1)
})
let attempts = 0
let recovered = await take(
  [good, after],
  () =>
    ++attempts == 1
      ? Promise.reject(Error('connection lost'))
      : Promise.resolve(),
)
test('a failed combined call is reported even when individual resends succeed', () => {
  equal(attempts, 3)
  equal(recovered.ack, [good, after])
  equal(recovered.reported.length, 1)
})
let deferred: { body: unknown; seconds: number }[][] = [], asks = 0
let postponing: Later = Object.assign(
  () => Promise.reject(Error('must batch')),
  {
    batch: (messages: { body: unknown; seconds: number }[]) => {
      deferred.push(messages)
      return Promise.resolve()
    },
  },
)
let stopped = await take(bodies, () => {
  asks++
  return Promise.reject(new Stopped(60_000, 'written'))
}, postponing)
test('a stopped scope is asked once and all its original messages are republished in one batch', () => {
  equal([asks, deferred.length], [1, 1])
  equal(deferred[0], bodies.map((body) => ({ body, seconds: 60 })))
  equal(stopped.ack, bodies)
  equal(stopped.retry, [])
  equal(stopped.reported, [])
})
let retained = await take(
  [good, after],
  () => Promise.reject(new Stopped(60_000, 'read')),
  Object.assign(() => Promise.resolve(), {
    batch: () => Promise.reject(Error('queue down')),
  }),
)
test('failed republication retains each original for retry instead of acknowledging it', () => {
  equal(retained.ack, [])
  equal(retained.retry, [good, after].map((body) => ({ body, seconds: 60 })))
  equal(retained.reported.length, 1)
})
let large = Array.from({ length: 5 }, () => {
  let [row] = rows()
  return [{ ...row, exception: { value: 'é'.repeat(40_000) } }]
})
let sized: number[] = []
await take(
  large,
  () => Promise.reject(new Stopped(1000, 'written')),
  Object.assign(
    () => Promise.resolve(),
    {
      batch: (messages: { body: unknown; seconds: number }[]) => {
        sized.push(new TextEncoder().encode(JSON.stringify(messages)).length)
        return Promise.resolve()
      },
    },
  ),
)
test('delayed republication splits UTF-8 bodies within the queue batch byte bound', () => {
  equal(sized.length, 3)
  ok(sized.every((size) => size < 256_000))
})
let sent: unknown[] = [], single = 0, queued = messages([good, after])
await worker({
  TRACKERS: {
    getByName: () =>
      ({ ingest: () => Promise.reject(new Stopped(1000, 'read')) }) as never,
  },
  ERRORS: {
    send: () => Promise.resolve(void single++),
    sendBatch: (messages) => Promise.resolve(void sent.push(messages)),
  },
}).queue(queued.messages)
test('the runtime wires delayed messages to Queue.sendBatch with individual delays', () => {
  equal(single, 0)
  equal(sent, [[good, after].map((body) => ({ body, delaySeconds: 1 }))])
  equal(queued.ack, [good, after])
})
