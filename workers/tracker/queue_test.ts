// Rejected error batches stay inspectable without retrying admission or
// multiplying reports; preserving them remains a retryable transport boundary.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { capture } from '@yaks/tracker/report'
import { type Stub, worker } from './worker.ts'

let fixture = () => {
  let saved: unknown[] = [],
    reported: Bundle[][] = [],
    admitted: Bundle[][] = []
  let unavailable = false
  let stub: Stub = {
    fetch: () => Promise.resolve(new Response()),
    ingest: (rows) => {
      admitted.push(rows)
      return Promise.resolve()
    },
    monitor: () => Promise.resolve(),
    admitTrace: () => Promise.resolve(),
    ingestTrace: () => Promise.resolve(true),
    settle: () => Promise.resolve(0),
    enroll: () => Promise.resolve(),
  }
  let env = {
    TRACKERS: { getByName: () => stub },
    ERRORS: {
      send: (rows: Bundle[]) => {
        reported.push(rows)
        return Promise.resolve()
      },
    },
    REJECTED: {
      send: (body: unknown) => {
        if (unavailable) return Promise.reject(Error('dead letter unavailable'))
        saved.push(body)
        return Promise.resolve()
      },
    },
  }
  let queue = worker(env).queue
  let send = async (body: unknown) => {
    let ack = 0, retry = 0
    await queue([{
      id: 'rejected-message',
      body,
      ack: () => {
        equal(saved.at(-1), body)
        ack++
      },
      retry: () => retry++,
    }])
    return [ack, retry]
  }
  return {
    saved,
    reported,
    admitted,
    send,
    outage: (value: boolean) => unavailable = value,
  }
}
let captureRows = (eid: string = crypto.randomUUID()) =>
  capture(Error('broken'), { sink: () => {}, eid })
let guarded = captureRows()
guarded[0].$was = { error: { bug: null } }
let deleted = captureRows()
deleted[0].$delete = true
let mixed = [
  ...captureRows().map((row) => ({
    ...row,
    during: { space: crypto.randomUUID() },
  })),
  ...captureRows(),
]
for (
  let [name, body] of Object.entries({
    empty: [],
    oversized: Array.from({ length: 101 }, () => captureRows()[0]),
    nonrecord: [null],
    named: captureRows('named-error'),
    guarded,
    deleted,
    mixed,
  })
) {
  test(`queue sets aside a ${name} batch and reports once`, async () => {
    let f = fixture()
    equal(await f.send(body), [1, 0])
    equal(f.saved, [body])
    equal([f.reported.length, f.admitted.length], [0, 1])
  })
}
test('queue retries failed preservation without reporting admission again', async () => {
  let f = fixture(), body = captureRows('named-error')
  f.outage(true)
  equal(await f.send(body), [0, 1])
  equal(await f.send(body), [0, 1])
  equal(f.saved, [])
  equal(f.admitted, [])
  f.outage(false)
  equal(await f.send(body), [1, 0])
  equal(f.saved, [body])
  equal([f.reported.length, f.admitted.length], [0, 1])
})
test('queue redelivery keeps the rejection report identity', async () => {
  let f = fixture(), body = captureRows('named-error')
  await f.send(body)
  await f.send(body)
  equal(f.admitted[0][0].entity.eid, f.admitted[1][0].entity.eid)
  equal(f.admitted[0][1].entity.eid, f.admitted[1][1].entity.eid)
})

test('a failed intake waits longer each delivery and sends nothing back through the queue', async () => {
  let queued: Bundle[][] = [], asked = 0, waits: (number | undefined)[] = []
  let { queue } = worker({
    TRACKERS: {
      getByName: () =>
        ({
          ingest: () => {
            asked++
            return Promise.reject(Error('object down'))
          },
        }) as never,
    },
    ERRORS: { send: (rows) => Promise.resolve(void queued.push(rows)) },
  })
  let failure = () => capture(Error('missing row'), { sink: () => {} })
  await queue([1, 3, 40].map((attempts) => ({
    body: failure(),
    attempts,
    ack: () => {},
    retry: (options) => waits.push(options?.delaySeconds),
  })))
  equal(waits, [2, 8, 300])
  // One combined intake, three individual intakes and the one report of the batch, told to the object itself.
  equal([asked, queued.length], [5, 0])
})
