// A hung HTTP handler reaches the tracker before it returns or throws.
import { clock, equal, ok, test, throws } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { origin } from '@yaks/tracker/report'
import { watched, within } from './defects.ts'
import { apart, elapsed, tallying } from './lib/hops.ts'
import { watch } from './lib/watch.ts'
import { entry } from './defects-runtime.ts'

let fixture = () => {
  let rows: Bundle[][] = [], retained: Promise<void>[] = [], time = clock()
  let env = {
    ERRORS: {
      send: (batch: Bundle[]) => {
        rows.push(batch)
        return Promise.resolve()
      },
    },
    CF_VERSION_METADATA: { id: 'deploy' },
  }
  let run = <T>(path: string, work: () => T) =>
    within(
      env,
      { request: 'gateway fetch' },
      () => watched(work, time),
      time,
      {
        retain: (pending) => retained.push(pending),
        origin: origin('yak', 'deploy', 'gateway fetch', new Request(path)),
      },
    )
  return { rows, retained, time, run }
}

test('the runtime watches HTTP entrypoints while their handler is unanswered', async () => {
  let f = fixture(), answer = Promise.withResolvers<Response>()
  let result = entry(
    {
      ERRORS: {
        send: (batch: Bundle[]) => {
          f.rows.push(batch)
          return Promise.resolve()
        },
      },
      CLOCK: f.time,
    },
    'gateway fetch',
    () => elapsed('vault_wait', () => answer.promise),
    new Request('https://yaks.app/connections'),
  )
  try {
    await f.time.advance(60_000)
    equal(f.rows.length, 1)
    equal(
      (f.rows[0][1].request as { url: string }).url,
      'https://yaks.app/connections',
    )
  } finally {
    answer.resolve(new Response(null))
    await result
  }
})

test('an unanswered request files its pending waits and route before it finishes', async () => {
  let f = fixture(), vault = Promise.withResolvers<Response>()
  let answered = false
  let result = f.run('https://yaks.app/connections?token=secret', async () => {
    await elapsed('directory_wait', () => Promise.resolve())
    return tallying(new Map(), () => elapsed('vault_wait', () => vault.promise))
  }).then((res) => (answered = true, res))
  await f.time.advance(59_999)
  equal(f.rows, [])
  await f.time.advance(1)
  await Promise.all(f.retained)
  equal(answered, false)
  equal(f.rows.length, 1)
  let [error, http] = f.rows[0]
  equal(
    (error.exception as { value: string }).value,
    'Request has not answered for 60 seconds',
  )
  equal(
    (error.error as { tags: Record<string, string> }).tags.waiting,
    '[{"name":"vault_wait","ms":60000}]',
  )
  equal((http.request as { url: string }).url, 'https://yaks.app/connections')
  equal(error.during, { request: http.entity.eid })
  await f.time.advance(120_000)
  equal(f.rows.length, 1)
  let answer = new Response('eventually answered')
  vault.resolve(answer)
  equal(await result, answer)
  equal(f.time.pending(), 0)
})

test('interleaved requests keep their waits apart and ignore detached work', async () => {
  let f = fixture(),
    first = Promise.withResolvers<void>(),
    second = Promise.withResolvers<void>(),
    detached = Promise.withResolvers<void>()
  let a = f.run(
    'https://yaks.app/first',
    () => elapsed('vault_wait', () => first.promise),
  )
  let b = f.run('https://yaks.app/second', () => {
    void apart(() => elapsed('detached_wait', () => detached.promise))
    return elapsed('directory_wait', () => second.promise)
  })
  first.resolve()
  await a
  await f.time.advance(60_000)
  await Promise.all(f.retained)
  equal(f.rows.length, 1)
  equal(
    (f.rows[0][1].request as { url: string }).url,
    'https://yaks.app/second',
  )
  equal(
    (f.rows[0][0].error as { tags: Record<string, string> }).tags.waiting,
    '[{"name":"directory_wait","ms":60000}]',
  )
  second.resolve()
  detached.resolve()
  await b
  await f.time.advance(10_000)
  equal(f.time.pending(), 0)
})

test('a handler with no named I/O still reports its pending response', async () => {
  let f = fixture(), answer = Promise.withResolvers<Response>()
  let result = f.run('https://yaks.app/loading', () => answer.promise)
  await f.time.advance(60_000)
  await Promise.all(f.retained)
  equal(
    (f.rows[0][0].error as { tags: Record<string, string> }).tags.waiting,
    'handler',
  )
  answer.resolve(new Response(null))
  await result
  await f.time.advance(10_000)
})

test('completed and failed handlers cancel their watches, and streams finish at headers', async () => {
  let time = clock(), reports: number[] = []
  let run = <T>(work: () => T) => watch(work, (ms) => reports.push(ms), time)
  equal(run(() => 42), 42)
  await throws(() =>
    run(() => {
      throw Error('synchronous')
    }), 'synchronous')
  await throws(
    () => run(() => Promise.reject(Error('asynchronous'))),
    'asynchronous',
  )
  let body = new ReadableStream<Uint8Array>({ start() {} })
  let response = new Response(body, {
    headers: { 'content-type': 'text/event-stream' },
  })
  equal(await run(() => Promise.resolve(response)), response)
  equal(time.pending(), 0)
  await time.advance(120_000)
  equal(reports, [])
  ok(!body.locked)
  await body.cancel()
})
