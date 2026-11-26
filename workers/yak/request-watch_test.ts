import { clock, equal, ok, test, throws } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { apart, elapsed, tallying } from './lib/hops.ts'
import { entry } from './defects-runtime.ts'

let fixture = () => {
  let rows: Bundle[][] = [], time = clock()
  let env = {
    CLOCK: time,
    ERRORS: {
      send: (batch: Bundle[]) => {
        rows.push(batch)
        return Promise.resolve()
      },
    },
    CF_VERSION_METADATA: { id: 'deploy' },
  }
  let run = (path: string, work: () => Promise<Response>) =>
    entry(env, 'gateway fetch', work, new Request(path))
  return { rows, time, run }
}

test('an unanswered connector request returns a timeout and reports its pending waits', async () => {
  let f = fixture(), vault = Promise.withResolvers<Response>()
  let result = f.run('https://yaks.app/mcp?token=secret', async () => {
    await elapsed('directory_wait', () => Promise.resolve())
    return tallying(new Map(), () => elapsed('vault_wait', () => vault.promise))
  })
  await f.time.advance(49_999)
  equal(f.rows, [])
  await f.time.advance(1)
  let answer = await result
  equal(answer.status, 504)
  equal(answer.headers.get('cache-control'), 'no-store')
  equal((await answer.json()).error.code, 'timeout')
  equal(f.rows.length, 1)
  let [error, http] = f.rows[0]
  equal(
    (error.error as { tags: Record<string, string> }).tags.waiting,
    '[{"name":"vault_wait","ms":50000}]',
  )
  equal((http.request as { url: string }).url, 'https://yaks.app/mcp')
  equal(error.during, { request: http.entity.eid })
  vault.resolve(new Response('late'))
  await f.time.advance(120_000)
  equal(f.rows.length, 1)
  equal(f.time.pending(), 0)
})

test('interleaved requests keep their waits apart and ignore detached work', async () => {
  let f = fixture(),
    first = Promise.withResolvers<Response>(),
    second = Promise.withResolvers<Response>(),
    detached = Promise.withResolvers<void>()
  let a = f.run(
    'https://yaks.app/first',
    () => elapsed('vault_wait', () => first.promise),
  )
  let b = f.run('https://yaks.app/second', () => {
    void apart(() => elapsed('detached_wait', () => detached.promise))
    return elapsed('directory_wait', () => second.promise)
  })
  first.resolve(new Response('first'))
  equal(await (await a).text(), 'first')
  await f.time.advance(50_000)
  equal((await b).status, 504)
  equal(f.rows.length, 1)
  equal(
    (f.rows[0][1].request as { url: string }).url,
    'https://yaks.app/second',
  )
  equal(
    (f.rows[0][0].error as { tags: Record<string, string> }).tags.waiting,
    '[{"name":"directory_wait","ms":50000}]',
  )
  second.resolve(new Response('late'))
  detached.resolve()
})

test('completed and failed handlers cancel the deadline and a stream keeps its lifetime', async () => {
  let f = fixture()
  let at = 'https://yaks.app/feed'
  await throws(() =>
    f.run(at, () => {
      throw Error('synchronous')
    }), 'synchronous')
  await throws(
    () => f.run(at, () => Promise.reject(Error('asynchronous'))),
    'asynchronous',
  )
  let body = new ReadableStream<Uint8Array>()
  let response = new Response(body, {
    headers: { 'content-type': 'text/event-stream' },
  })
  equal(await f.run(at, () => Promise.resolve(response)), response)
  equal(f.time.pending(), 0)
  await f.time.advance(120_000)
  equal(f.rows.length, 2)
  ok(!body.locked)
  await body.cancel()
})
