// Caught Worker failures identify their runtime invocation independently of
// incoming records and retain a scrubbed request for HTTP entrypoints.
import type { Bundle, Comp } from '@yaks/graph'
import { equal, test, throws } from '@yaks/testing'
import { type Stub, worker } from './worker.ts'
import { backoff } from '@yaks/durable-object'

backoff.wait = () => Promise.resolve()

// The object's failure as its stub hands it over, its stack already said: a
// report reads the stack, and formatting a fresh one is the runtime's work,
// not what these check.
let unavailable = () =>
  Object.assign(Error('tracker object unavailable'), {
    stack: 'Error: tracker object unavailable\n    at fetch (object.ts:1:1)',
  })

let hash = 'a'.repeat(64)
let fixture = (doors: Partial<Stub> = {}) => {
  let sent: Bundle[][] = []
  let fail = () => Promise.reject(unavailable())
  let stub: Stub = {
    fetch: fail,
    ingest: fail,
    monitor: fail,
    admitTrace: fail,
    ingestTrace: fail,
    ...doors,
  }
  let w = worker({
    BUNDLE_HASH: hash,
    TRACKER_SECRET: 'scratch',
    CF_VERSION_METADATA: { id: '00000000-0000-4000-8000-000000000012' },
    TRACKERS: { getByName: () => stub },
    ERRORS: {
      send: (rows) => {
        sent.push(rows)
        return Promise.resolve()
      },
    },
  })
  let check = (entrypoint: string) => {
    let [failure, companion] = sent.at(-1)!
    equal((failure.error as Comp).tags, {
      script: 'yak-tracker',
      version: '00000000-0000-4000-8000-000000000012',
      entrypoint,
    })
    equal(
      (failure.error as Comp).commit,
      '00000000-0000-4000-8000-000000000012',
    )
    equal(failure.during, { request: companion.entity.eid })
    equal((companion.request as Comp).route, entrypoint)
    return companion.request as Comp
  }
  return { w, check, sent }
}

test('caught tracker fetch preserves its scrubbed request and origin', async () => {
  let { w, check } = fixture()
  equal(
    (await w.fetch(
      new Request(
        'https://tracker.test/query?scope=platform&token=private',
      ),
    )).status,
    503,
  )
  let request = check('fetch')
  equal(request.method, 'GET')
  equal(request.url, 'https://tracker.test/query')
})

test('tracker queue and scheduled failures identify their entrypoint', async () => {
  let { w, check } = fixture()
  let retried = false
  await w.queue([{
    body: [{ entity: { eid: crypto.randomUUID() }, error: {} }],
    ack: () => {},
    retry: () => void (retried = true),
  }])
  equal(retried, true)
  check('queue')
  await throws(() => w.scheduled())
  check('scheduled')
})

// A mark, its body read again by each send, through `failures` lost or reset
// sends; what the Worker answers and how many sends the object saw.
let marked = async (failures: Error[]) => {
  let bodies: string[] = []
  let { w, sent } = fixture({
    fetch: async (request) => {
      bodies.push(await request.text())
      let failure = failures.shift()
      if (failure) throw failure
      return Response.json({ ok: true })
    },
  })
  let response = await w.fetch(
    new Request('https://tracker.test/take?scope=platform', {
      method: 'POST',
      body: '{"bug":"b"}',
    }),
  )
  return [response.status, bodies, sent.length]
}
// What a send to the object meets: its connection lost, the object reset,
// the runtime's opaque refusal while it moves the object, and a failure no
// resend mends.
let lost = Error('Network connection lost.')
let reset = Object.assign(Error('reset'), { retryable: true })
let refused = Error('internal error; reference = c7hprk25808kaqd3nagvsed3')
let broken = Error('boot failed')

test('a mark lost, reset or refused on its way to the object is sent again', async () => {
  equal(await marked([lost, refused, reset]), [
    200,
    Array(4).fill('{"bug":"b"}'),
    0,
  ])
  equal((await marked(Array(backoff.pauses.length + 1).fill(lost)))[0], 503)
  equal(await marked([broken]), [503, ['{"bug":"b"}'], 1])
})

// A deploy's canary read, through `failures` on its way to the object: what
// the Worker answers, and how many failures it reported.
let stood = async (failures: Error[]) => {
  let { w, sent } = fixture({
    fetch: (request) => {
      let failure = failures.shift()
      if (failure) return Promise.reject(failure)
      return Promise.resolve(
        Response.json(
          new URL(request.url).pathname == '/bundle' ? { hash } : [],
        ),
      )
    },
  })
  let response = await w.fetch(
    new Request(
      `https://tracker.test/canary?scope=platform&hash=${hash}&eid=${crypto.randomUUID()}`,
    ),
  )
  return [response.status, await response.json(), sent.length]
}

test("a canary's read of a moving object waits it out, unreported", async () => {
  equal(await stood([refused, lost, reset]), [200, { arrived: false }, 0])
  equal(
    await stood(Array(backoff.pauses.length + 1).fill(refused)),
    [503, { error: 'tracker temporarily unavailable' }, 1],
  )
})

// The minute's monitor or a queue's intake through `failures` on its way to
// the object: how many sends the object saw, and how many failures were
// reported.
let ran = async (door: 'monitor' | 'ingest', failures: Error[]) => {
  let sends = 0
  let { w, sent } = fixture({
    [door]: () => {
      sends++
      let failure = failures.shift()
      return failure ? Promise.reject(failure) : Promise.resolve()
    },
  })
  await (door == 'monitor' ? w.scheduled() : w.queue([{
    body: [{ entity: { eid: crypto.randomUUID() }, error: {} }],
    ack: () => {},
    retry: () => {},
  }])).catch(() => {})
  return [sends, sent.length]
}

test("the minute's monitor and a queue's intake wait out a moving object, unreported", async () => {
  for (let door of ['monitor', 'ingest'] as const) {
    equal(await ran(door, [lost, refused, reset]), [4, 0])
    equal(await ran(door, [broken]), [1, 1])
  }
})
